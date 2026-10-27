use reqwest::{header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION}, Url};
use serde::Deserialize;
use std::{os::windows::process::CommandExt, process::Command};
use tauri_plugin_updater::{Update, UpdaterExt};
use super::update_state::Step;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Configuration {
    repository: String,
    release_tag: Option<String>,
}

#[derive(Deserialize)]
struct Release { assets: Vec<Asset> }
#[derive(Deserialize)]
struct Asset { name: String, url: Url }

fn repository_path(repository: &str) -> Result<String, String> {
    let parts: Vec<_> = repository.split('/').collect();
    if parts.len() != 2 || parts.iter().any(|part| part.is_empty()
        || !part.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))) {
        return Err("私有更新仓库必须使用 owner/repository 格式".into());
    }
    Ok(format!("/repos/{repository}/releases/"))
}

// The manifest is remote input. Never send the local GitHub credential to an arbitrary URL.
fn validate_asset(url: &Url, repository: &str) -> Result<(), String> {
    let prefix = format!("{}assets/", repository_path(repository)?);
    let asset_id = url.path().strip_prefix(&prefix).and_then(|id| id.parse::<u64>().ok());
    if url.scheme() != "https" || url.host_str() != Some("api.github.com")
        || url.port_or_known_default() != Some(443) || !url.username().is_empty()
        || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || asset_id.is_none() {
        return Err("更新资产地址必须属于配置的 GitHub 私有仓库".into());
    }
    Ok(())
}

fn credentials() -> Result<HeaderMap, String> {
    // Private developer builds reuse the user's gh login. CREATE_NO_WINDOW avoids a console popup.
    let output = Command::new("gh").args(["auth", "token", "--hostname", "github.com"])
        .creation_flags(0x08000000).output()
        .map_err(|error| format!("私有更新需要 GitHub CLI：{error}。请安装 gh 并执行 gh auth login"))?;
    if !output.status.success() {
        return Err("无法读取 GitHub 登录，请执行 gh auth login 并确认账号可访问私有仓库".into());
    }
    let token = String::from_utf8(output.stdout).map_err(|_| "GitHub 登录凭据编码无效")?;
    let token = token.trim();
    if token.is_empty() { return Err("GitHub CLI 返回了空凭据，请重新登录".into()); }
    let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "GitHub 登录凭据格式无效")?;
    authorization.set_sensitive(true);
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, authorization);
    headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
    headers.insert("x-github-api-version", HeaderValue::from_static("2022-11-28"));
    Ok(headers)
}

pub async fn check(app: &tauri::AppHandle, progress: impl Fn(Step) -> Result<(), String>) -> Result<Option<Update>, String> {
    let value = app.config().plugins.0.get("privateUpdater")
        .ok_or("缺少 privateUpdater 配置")?.clone();
    let config: Configuration = serde_json::from_value(value).map_err(|error| error.to_string())?;
    let prefix = repository_path(&config.repository)?;
    let mut url = Url::parse(&format!("https://api.github.com{prefix}"))
        .map_err(|error| error.to_string())?;
    {
        let mut path = url.path_segments_mut().map_err(|_| "GitHub Release 地址无效")?;
        path.pop_if_empty();
        match &config.release_tag {
            Some(tag) if !tag.is_empty() => { path.push("tags").push(tag); }
            Some(_) => return Err("固定 Release 标签不能为空".into()),
            None => { path.push("latest"); }
        }
    }
    let headers = tauri::async_runtime::spawn_blocking(credentials).await
        .map_err(|error| error.to_string())??;
    progress(Step::Github)?;
    let response = reqwest::Client::builder().user_agent("Monorail-Updater")
        .default_headers(headers.clone()).build().map_err(|error| error.to_string())?
        .get(url).header(ACCEPT, "application/vnd.github+json").send().await
        .map_err(|error| format!("连接 GitHub 失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("读取 GitHub 发布失败（HTTP {}）：请确认仓库已有发布版本，且当前账号有读取权限", response.status()));
    }
    progress(Step::Release)?;
    let release: Release = response.json().await.map_err(|error| format!("Release 数据无效：{error}"))?;
    let manifest = release.assets.iter().find(|asset| asset.name == "latest.json")
        .ok_or("该 Release 缺少 latest.json，发布尚未完整")?;
    validate_asset(&manifest.url, &config.repository)?;
    progress(Step::Manifest)?;
    let update = app.updater_builder().endpoints(vec![manifest.url.clone()])
        .map_err(|error| error.to_string())?.headers(headers).build()
        .map_err(|error| error.to_string())?.check().await.map_err(|error| error.to_string())?;
    if let Some(update) = &update { validate_asset(&update.download_url, &config.repository)?; }
    Ok(update)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_only_go_to_the_configured_https_asset_api() {
        let repository = "owner/project";
        assert!(validate_asset(&Url::parse("https://api.github.com/repos/owner/project/releases/assets/42").unwrap(), repository).is_ok());
        for url in [
            "http://api.github.com/repos/owner/project/releases/assets/42",
            "https://example.com/repos/owner/project/releases/assets/42",
            "https://api.github.com/repos/other/project/releases/assets/42",
            "https://api.github.com/repos/owner/project/releases/assets/42?token=x",
            "https://user@api.github.com/repos/owner/project/releases/assets/42",
            "https://api.github.com/repos/owner/project/releases/assets/invalid",
        ] { assert!(validate_asset(&Url::parse(url).unwrap(), repository).is_err(), "{url}"); }
        assert!(repository_path("owner/../other").is_err());
    }
}

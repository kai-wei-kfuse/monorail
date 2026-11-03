use http::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use serde::Deserialize;
use std::{
    cmp::Ordering,
    collections::HashMap,
    fmt,
    os::windows::process::CommandExt,
    process::Command,
};
use tauri_plugin_updater::UpdaterExt;
use url::Url;
use super::update_channel::{Channel, UpdateIntent};
use super::update_state::{Candidate, CompatibilityInfo, ReleaseInfo, Step, TargetPermit};

pub const CURRENT_DATA_SCHEMA_VERSION: u32 = 2;
pub const AUDITED_COMPATIBLE_STABLE_VERSIONS: &[(&str, u32)] = &[("0.2.5", 2)];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Configuration {
    repository: String,
    release_tag: Option<String>,
    #[serde(default)]
    api_base_url: Option<Url>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReleaseRecord {
    #[serde(default)]
    pub id: u64,
    #[serde(default)]
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub body: Option<String>,
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Asset {
    pub name: String,
    pub url: Url,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonorailManifestMeta {
    pub channel: String,
    pub data_schema_version: u32,
    pub readable_data_schema_versions: Vec<u32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ManifestPlatform {
    pub url: Url,
    pub signature: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReleaseManifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub platforms: HashMap<String, ManifestPlatform>,
    #[serde(default)]
    pub monorail: Option<MonorailManifestMeta>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProductVersion {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub beta: Option<u64>,
}

impl ProductVersion {
    pub fn channel(&self) -> Channel {
        if self.beta.is_some() {
            Channel::Beta
        } else {
            Channel::Stable
        }
    }
}

impl fmt::Display for ProductVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.beta {
            Some(n) => write!(f, "{}.{}.{}-beta.{n}", self.major, self.minor, self.patch),
            None => write!(f, "{}.{}.{}", self.major, self.minor, self.patch),
        }
    }
}

impl PartialOrd for ProductVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ProductVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.beta, other.beta) {
                (None, None) => Ordering::Equal,
                // Stable release with the same base version is higher than any beta.
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(a), Some(b)) => a.cmp(&b),
            })
    }
}

fn parse_non_leading_zero_u64(part: &str) -> Option<u64> {
    if part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if part.len() > 1 && part.starts_with('0') {
        return None;
    }
    part.parse::<u64>().ok()
}

pub fn parse_product_version(raw: &str) -> Result<ProductVersion, String> {
    if raw.is_empty() || raw.contains('+') {
        return Err(format!("不支持的产品版本号格式：{raw}"));
    }
    let (core, prerelease) = match raw.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (raw, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return Err(format!("版本号必须为 X.Y.Z 格式：{raw}"));
    }
    let major = parse_non_leading_zero_u64(parts[0]).ok_or_else(|| format!("无效的主版本号：{raw}"))?;
    let minor = parse_non_leading_zero_u64(parts[1]).ok_or_else(|| format!("无效的次版本号：{raw}"))?;
    let patch = parse_non_leading_zero_u64(parts[2]).ok_or_else(|| format!("无效的修订号：{raw}"))?;
    let beta = match prerelease {
        None => None,
        Some(pre) => {
            let number_str = pre
                .strip_prefix("beta.")
                .ok_or_else(|| format!("仅支持 beta.N 预发布版本：{raw}"))?;
            let number = parse_non_leading_zero_u64(number_str)
                .filter(|&n| n >= 1)
                .ok_or_else(|| format!("无效的 Beta 序号：{raw}"))?;
            Some(number)
        }
    };
    Ok(ProductVersion {
        major,
        minor,
        patch,
        beta,
    })
}

pub fn parse_product_tag(tag: &str) -> Option<ProductVersion> {
    let raw = tag.strip_prefix('v')?;
    parse_product_version(raw).ok()
}

pub fn parse_release_list(bytes: &[u8]) -> Result<Vec<ReleaseRecord>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|error| format!("Release 列表数据无效：{error}"))?;
    let array = value.as_array().ok_or("Release 列表响应必须是 JSON 数组")?;
    if array.first().is_some_and(|first| first.is_array()) {
        let pages: Vec<Vec<ReleaseRecord>> =
            serde_json::from_value(value).map_err(|error| format!("Release 分页数据无效：{error}"))?;
        Ok(pages.into_iter().flatten().collect())
    } else {
        serde_json::from_value(value).map_err(|error| format!("Release 数据无效：{error}"))
    }
}

pub fn select_release_candidate(
    releases: &[ReleaseRecord],
    channel: Channel,
    intent: UpdateIntent,
) -> Option<(ReleaseRecord, ProductVersion)> {
    let effective_channel = match intent {
        UpdateIntent::ReturnToStable => Channel::Stable,
        UpdateIntent::Upgrade => channel,
    };
    let mut best: Option<(ReleaseRecord, ProductVersion)> = None;
    for release in releases {
        if release.draft || release.tag_name.starts_with("update-test-") {
            continue;
        }
        let Some(version) = parse_product_tag(&release.tag_name) else {
            continue;
        };
        // Reject contradictory GitHub prerelease flags vs tag semantics.
        if version.beta.is_some() != release.prerelease {
            continue;
        }
        if effective_channel == Channel::Stable && version.beta.is_some() {
            continue;
        }
        match &best {
            None => best = Some((release.clone(), version)),
            Some((_, current_best)) if version > *current_best => {
                best = Some((release.clone(), version));
            }
            _ => {}
        }
    }
    best
}

fn repository_path(repository: &str) -> Result<String, String> {
    let parts: Vec<_> = repository.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty() || !part.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        })
    {
        return Err("私有更新仓库必须使用 owner/repository 格式".into());
    }
    Ok(format!("/repos/{repository}/releases/"))
}

#[cfg(any(test, debug_assertions, feature = "verify"))]
pub const PRODUCTION_IDENTIFIER: &str = "local.pixelrecord.app";
#[cfg(any(test, debug_assertions, feature = "verify"))]
pub const ISOLATED_TEST_IDENTIFIER: &str = "local.pixelrecord.beta-channel-test";

pub fn validate_api_base_override(identifier: &str, api_base_url: Option<&Url>) -> Result<Option<Url>, String> {
    let Some(base) = api_base_url else {
        return Ok(None);
    };
    #[cfg(not(any(test, debug_assertions, feature = "verify")))]
    {
        let _ = (identifier, base);
        return Err("正式发布构建禁止覆盖 GitHub API 地址".into());
    }
    #[cfg(any(test, debug_assertions, feature = "verify"))]
    {
        if identifier == PRODUCTION_IDENTIFIER || identifier != ISOLATED_TEST_IDENTIFIER {
            return Err("仅显式隔离验收测试身份（local.pixelrecord.beta-channel-test）允许使用本机回环 API 夹具".into());
        }
        if base.scheme() != "http"
            || base.host_str() != Some("127.0.0.1")
            || base.port().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err("隔离验收 API 地址仅允许本机 127.0.0.1:<port> 回环地址".into());
        }
        Ok(Some(base.clone()))
    }
}

// The manifest is remote input. Never send the local GitHub credential to an arbitrary URL.
#[cfg(test)]
pub fn validate_asset(url: &Url, repository: &str) -> Result<(), String> {
    validate_asset_with_base(url, repository, None)
}

pub fn validate_asset_with_base(
    url: &Url,
    repository: &str,
    isolated_base: Option<&Url>,
) -> Result<(), String> {
    let prefix = format!("{}assets/", repository_path(repository)?);
    let asset_id = url.path().strip_prefix(&prefix).and_then(|id| id.parse::<u64>().ok());
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || asset_id.is_none()
    {
        return Err("更新资产地址必须属于配置的 GitHub 私有仓库".into());
    }
    match isolated_base {
        None => {
            if url.scheme() != "https"
                || url.host_str() != Some("api.github.com")
                || url.port_or_known_default() != Some(443)
            {
                return Err("更新资产地址必须属于配置的 GitHub 私有仓库".into());
            }
        }
        Some(base) => {
            if url.scheme() != base.scheme()
                || url.host_str() != base.host_str()
                || url.port() != base.port()
            {
                return Err("隔离验收资产地址必须属于配置的本机回环服务".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
pub fn validate_manifest_and_compatibility(
    manifest_bytes: &[u8],
    expected_version: &ProductVersion,
    is_update_test: bool,
    repository: &str,
    current_version: &ProductVersion,
) -> Result<(ReleaseManifest, CompatibilityInfo), String> {
    validate_manifest_and_compatibility_with_base(
        manifest_bytes,
        expected_version,
        is_update_test,
        repository,
        current_version,
        None,
    )
}

pub fn validate_manifest_and_compatibility_with_base(
    manifest_bytes: &[u8],
    expected_version: &ProductVersion,
    is_update_test: bool,
    repository: &str,
    _current_version: &ProductVersion,
    isolated_base: Option<&Url>,
) -> Result<(ReleaseManifest, CompatibilityInfo), String> {
    let manifest: ReleaseManifest =
        serde_json::from_slice(manifest_bytes).map_err(|error| format!("更新清单 latest.json 无效：{error}"))?;
    let expected_version_str = expected_version.to_string();
    if manifest.version != expected_version_str {
        return Err(format!(
            "Release 清单版本（{}）与标签版本（{}）不一致",
            manifest.version, expected_version_str
        ));
    }
    let platform = manifest
        .platforms
        .get("windows-x86_64")
        .ok_or("更新清单缺少 windows-x86_64 平台安装包条目")?;
    validate_asset_with_base(&platform.url, repository, isolated_base)?;
    if platform.signature.trim().is_empty() {
        return Err("更新清单中的安装包签名不能为空".into());
    }

    let expected_channel_label = if is_update_test {
        "update-test"
    } else if expected_version.beta.is_some() {
        "beta"
    } else {
        "stable"
    };

    let compatibility = match &manifest.monorail {
        Some(meta) => {
            if meta.channel != expected_channel_label {
                return Err(format!(
                    "Release 清单元数据渠道声明（{}）与标签类型（{}）矛盾",
                    meta.channel, expected_channel_label
                ));
            }
            if meta.readable_data_schema_versions.is_empty()
                || !meta
                    .readable_data_schema_versions
                    .contains(&meta.data_schema_version)
            {
                return Err("Release 清单中的数据格式兼容声明无效".into());
            }
            let compatible = meta
                .readable_data_schema_versions
                .contains(&CURRENT_DATA_SCHEMA_VERSION);
            let reason = if compatible {
                format!(
                    "清单已声明兼容当前数据格式（schema v{}）：覆盖安装将保留全部业务数据与 Beta 期间新增记录",
                    CURRENT_DATA_SCHEMA_VERSION
                )
            } else {
                format!(
                    "目标版本 v{} 仅支持读取数据格式 {:?}，无法直接读取当前数据格式（schema v{}），已阻止覆盖安装以防数据丢失",
                    expected_version_str,
                    meta.readable_data_schema_versions,
                    CURRENT_DATA_SCHEMA_VERSION
                )
            };
            CompatibilityInfo {
                compatible,
                source: "manifest".into(),
                data_schema_version: Some(meta.data_schema_version),
                readable_data_schema_versions: meta.readable_data_schema_versions.clone(),
                reason,
            }
        }
        None => {
            if is_update_test {
                CompatibilityInfo {
                    compatible: true,
                    source: "updateTest".into(),
                    data_schema_version: Some(CURRENT_DATA_SCHEMA_VERSION),
                    readable_data_schema_versions: vec![CURRENT_DATA_SCHEMA_VERSION],
                    reason: format!(
                        "隔离更新验收版本（schema v{}）",
                        CURRENT_DATA_SCHEMA_VERSION
                    ),
                }
            } else if expected_version.beta.is_none()
                && AUDITED_COMPATIBLE_STABLE_VERSIONS
                    .iter()
                    .any(|&(ver, schema)| ver == expected_version_str && schema == CURRENT_DATA_SCHEMA_VERSION)
            {
                CompatibilityInfo {
                    compatible: true,
                    source: "auditedTable".into(),
                    data_schema_version: Some(CURRENT_DATA_SCHEMA_VERSION),
                    readable_data_schema_versions: vec![CURRENT_DATA_SCHEMA_VERSION],
                    reason: format!(
                        "已通过源码与实测兼容核验（schema v{}）：v{} 可直接读取 Beta 期间新增的想法、待办、任务卡、计时与附件",
                        CURRENT_DATA_SCHEMA_VERSION, expected_version_str
                    ),
                }
            } else {
                CompatibilityInfo {
                    compatible: false,
                    source: "unverifiedMissingMetadata".into(),
                    data_schema_version: None,
                    readable_data_schema_versions: vec![],
                    reason: format!(
                        "候选版本 v{} 的发布清单缺少 monorail 数据兼容声明，且不在已核验的版本兼容表中；无法确认数据格式兼容性，已阻止覆盖安装",
                        expected_version_str
                    ),
                }
            }
        }
    };

    Ok((manifest, compatibility))
}

pub fn should_accept_remote_version(
    current_version: &str,
    remote_version: &str,
    permitted_target_version: &str,
    channel: Channel,
    intent: UpdateIntent,
    compatible: bool,
) -> bool {
    if !compatible || remote_version != permitted_target_version {
        return false;
    }
    let (Ok(current), Ok(remote)) = (
        parse_product_version(current_version),
        parse_product_version(remote_version),
    ) else {
        return false;
    };
    match intent {
        UpdateIntent::Upgrade => {
            if channel == Channel::Stable && remote.beta.is_some() {
                return false;
            }
            remote > current
        }
        UpdateIntent::ReturnToStable => {
            if channel != Channel::Stable || remote.beta.is_some() {
                return false;
            }
            remote != current
        }
    }
}

fn github(args: &[&str]) -> Result<Vec<u8>, String> {
    // Reuse gh's private-repository transport; the official updater owns its own TLS initialization.
    // Do not inherit HTTP debug logging into errors that may reach the UI with authentication headers.
    let output = Command::new("gh")
        .args(args)
        .env_remove("GH_DEBUG")
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| format!("私有更新需要 GitHub CLI：{error}。请安装 gh 并执行 gh auth login"))?;
    if !output.status.success() {
        return Err(format!(
            "GitHub CLI 请求失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

fn credentials() -> Result<HeaderMap, String> {
    let token = String::from_utf8(github(&["auth", "token", "--hostname", "github.com"])?)
        .map_err(|_| "GitHub 登录凭据编码无效")?;
    let token = token.trim();
    if token.is_empty() {
        return Err("GitHub CLI 返回了空凭据，请重新登录".into());
    }
    let mut authorization =
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| "GitHub 登录凭据格式无效")?;
    authorization.set_sensitive(true);
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, authorization);
    headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
    headers.insert("x-github-api-version", HeaderValue::from_static("2022-11-28"));
    Ok(headers)
}

fn fetch_isolated_loopback(url: &str) -> Result<Vec<u8>, String> {
    let output = Command::new("curl.exe")
        .args(["-fsSL", "-H", "Accept: application/octet-stream", url])
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| format!("隔离回环请求失败：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "隔离回环请求返回错误：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

pub enum CheckOutcome {
    Current,
    Available(Candidate, Option<TargetPermit>),
    IncompatibleTarget(ReleaseInfo),
}

pub async fn check(
    app: &tauri::AppHandle,
    channel: Channel,
    intent: UpdateIntent,
    progress: impl Fn(Step) -> Result<(), String>,
) -> Result<CheckOutcome, String> {
    let value = app
        .config()
        .plugins
        .0
        .get("privateUpdater")
        .ok_or("缺少 privateUpdater 配置")?
        .clone();
    let config: Configuration = serde_json::from_value(value).map_err(|error| error.to_string())?;
    let isolated_base = validate_api_base_override(&app.config().identifier, config.api_base_url.as_ref())?;
    let prefix = repository_path(&config.repository)?;
    let current_version_str = app.package_info().version.to_string();
    let current_version = parse_product_version(&current_version_str)?;

    let headers = if isolated_base.is_some() {
        let mut h = HeaderMap::new();
        h.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
        h
    } else {
        tauri::async_runtime::spawn_blocking(credentials)
            .await
            .map_err(|error| error.to_string())??
    };
    progress(Step::Github)?;

    let api_origin = match &isolated_base {
        Some(base) => format!("{}://{}:{}", base.scheme(), base.host_str().unwrap_or("127.0.0.1"), base.port().unwrap_or(80)),
        None => "https://api.github.com".to_string(),
    };

    let (target_release, target_version, is_update_test) = match &config.release_tag {
        Some(tag) if !tag.is_empty() => {
            if intent == UpdateIntent::ReturnToStable {
                return Err("固定 Release 验收配置不支持显式切换稳定版回退".into());
            }
            let mut url = Url::parse(&format!("{api_origin}{prefix}"))
                .map_err(|error| error.to_string())?;
            {
                let mut path = url.path_segments_mut().map_err(|_| "GitHub Release 地址无效")?;
                path.pop_if_empty();
                path.push("tags").push(tag);
            }
            let is_loopback = isolated_base.is_some();
            let response = tauri::async_runtime::spawn_blocking(move || {
                if is_loopback {
                    fetch_isolated_loopback(url.as_str())
                } else {
                    github(&["api", "--hostname", "github.com", url.as_str()])
                }
            })
            .await
            .map_err(|error| error.to_string())??;
            progress(Step::Release)?;
            let release: ReleaseRecord =
                serde_json::from_slice(&response).map_err(|error| format!("Release 数据无效：{error}"))?;
            let raw_ver = tag
                .strip_prefix("update-test-v")
                .or_else(|| tag.strip_prefix('v'))
                .ok_or_else(|| format!("固定 Release 标签格式无效：{tag}"))?;
            let version = parse_product_version(raw_ver)?;
            if version <= current_version {
                return Ok(CheckOutcome::Current);
            }
            (release, version, tag.starts_with("update-test-"))
        }
        Some(_) => return Err("固定 Release 标签不能为空".into()),
        None => {
            let list_url = format!("{api_origin}{prefix}?per_page=100");
            let list_url_trimmed = list_url.replace("/releases/?", "/releases?");
            let is_loopback = isolated_base.is_some();
            let response = tauri::async_runtime::spawn_blocking(move || {
                if is_loopback {
                    fetch_isolated_loopback(&list_url_trimmed)
                } else {
                    github(&[
                        "api",
                        "--hostname",
                        "github.com",
                        "--paginate",
                        "--slurp",
                        &list_url_trimmed,
                    ])
                }
            })
            .await
            .map_err(|error| error.to_string())??;
            progress(Step::Release)?;
            let releases = parse_release_list(&response)?;
            let Some((release, version)) = select_release_candidate(&releases, channel, intent) else {
                return match intent {
                    UpdateIntent::Upgrade => Ok(CheckOutcome::Current),
                    UpdateIntent::ReturnToStable => Err("未在 GitHub Releases 中找到可用的正式稳定版本".into()),
                };
            };
            match intent {
                UpdateIntent::Upgrade if version <= current_version => {
                    return Ok(CheckOutcome::Current);
                }
                UpdateIntent::ReturnToStable if version == current_version => {
                    return Ok(CheckOutcome::Current);
                }
                _ => {}
            }
            (release, version, false)
        }
    };

    let manifest_asset = target_release
        .assets
        .iter()
        .find(|asset| asset.name == "latest.json")
        .ok_or_else(|| {
            format!(
                "目标版本 {} 缺少 latest.json，发布尚未完整",
                target_release.tag_name
            )
        })?;
    validate_asset_with_base(&manifest_asset.url, &config.repository, isolated_base.as_ref())?;
    progress(Step::Manifest)?;

    let manifest_url_for_gh = manifest_asset.url.to_string();
    let is_loopback = isolated_base.is_some();
    let manifest_bytes = tauri::async_runtime::spawn_blocking(move || {
        if is_loopback {
            fetch_isolated_loopback(&manifest_url_for_gh)
        } else {
            github(&[
                "api",
                "--hostname",
                "github.com",
                "-H",
                "Accept: application/octet-stream",
                &manifest_url_for_gh,
            ])
        }
    })
    .await
    .map_err(|error| error.to_string())??;

    let (parsed_manifest, compatibility) = validate_manifest_and_compatibility_with_base(
        &manifest_bytes,
        &target_version,
        is_update_test,
        &config.repository,
        &current_version,
        isolated_base.as_ref(),
    )?;

    let is_downgrade = target_version < current_version;
    let info = ReleaseInfo {
        version: target_version.to_string(),
        notes: parsed_manifest.notes.or(target_release.body),
        tag: target_release.tag_name.clone(),
        release_id: target_release.id,
        channel: target_version.channel(),
        is_downgrade,
        compatibility: compatibility.clone(),
    };

    if !compatibility.compatible {
        return Ok(CheckOutcome::IncompatibleTarget(info));
    }

    let permitted_version = target_version.to_string();
    let mut builder = app
        .updater_builder()
        .endpoints(vec![manifest_asset.url.clone()])
        .map_err(|error| error.to_string())?
        .headers(headers);

    if intent == UpdateIntent::ReturnToStable {
        let permitted = permitted_version.clone();
        builder = builder.version_comparator(move |current, remote| {
            should_accept_remote_version(
                &current.to_string(),
                &remote.version.to_string(),
                &permitted,
                Channel::Stable,
                UpdateIntent::ReturnToStable,
                true,
            )
        });
    } else {
        let permitted = permitted_version.clone();
        builder = builder.version_comparator(move |current, remote| {
            let cur = current.to_string();
            let rem = remote.version.to_string();
            if is_update_test {
                rem == permitted && remote.version > current
            } else {
                should_accept_remote_version(&cur, &rem, &permitted, channel, UpdateIntent::Upgrade, true)
            }
        });
    }

    let update = builder
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let Some(update) = update else {
        return Ok(CheckOutcome::Current);
    };
    validate_asset_with_base(&update.download_url, &config.repository, isolated_base.as_ref())?;
    let download_url = update.download_url.to_string();
    let permit = if intent == UpdateIntent::ReturnToStable {
        Some(TargetPermit {
            intent: UpdateIntent::ReturnToStable,
            version: info.version.clone(),
            tag: info.tag.clone(),
            release_id: info.release_id,
            download_url: download_url.clone(),
            compatible: true,
        })
    } else {
        None
    };
    let notes = update.body.clone().or(info.notes);
    let candidate = Candidate {
        update: Some(update),
        info: ReleaseInfo { notes, ..info },
        download_url,
    };
    Ok(CheckOutcome::Available(candidate, permit))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(id: u64, tag: &str, draft: bool, prerelease: bool) -> ReleaseRecord {
        ReleaseRecord {
            id,
            tag_name: tag.into(),
            draft,
            prerelease,
            body: Some(format!("Notes for {tag}")),
            assets: vec![Asset {
                name: "latest.json".into(),
                url: Url::parse(&format!(
                    "https://api.github.com/repos/owner/project/releases/assets/{id}"
                ))
                .unwrap(),
            }],
        }
    }

    #[test]
    fn credentials_only_go_to_the_configured_https_asset_api() {
        let repository = "owner/project";
        assert!(validate_asset(
            &Url::parse("https://api.github.com/repos/owner/project/releases/assets/42").unwrap(),
            repository
        )
        .is_ok());
        for url in [
            "http://api.github.com/repos/owner/project/releases/assets/42",
            "https://example.com/repos/owner/project/releases/assets/42",
            "https://api.github.com/repos/other/project/releases/assets/42",
            "https://api.github.com/repos/owner/project/releases/assets/42?token=x",
            "https://user@api.github.com/repos/owner/project/releases/assets/42",
            "https://api.github.com/repos/owner/project/releases/assets/invalid",
        ] {
            assert!(
                validate_asset(&Url::parse(url).unwrap(), repository).is_err(),
                "{url}"
            );
        }
        assert!(repository_path("owner/../other").is_err());
        let loopback = Url::parse("http://127.0.0.1:19876").unwrap();
        assert!(validate_api_base_override("local.pixelrecord.app", Some(&loopback)).is_err());
        assert!(validate_api_base_override("local.pixelrecord.beta-channel-test", Some(&loopback)).is_ok());
        assert!(validate_api_base_override(
            "local.pixelrecord.beta-channel-test",
            Some(&Url::parse("https://example.com:8443").unwrap())
        )
        .is_err());
    }

    #[test]
    fn semver_ordering_ranks_beta_10_above_beta_9_and_stable_above_same_base_beta() {
        let b9 = parse_product_version("0.3.0-beta.9").unwrap();
        let b10 = parse_product_version("0.3.0-beta.10").unwrap();
        let s030 = parse_product_version("0.3.0").unwrap();
        let b031 = parse_product_version("0.3.1-beta.1").unwrap();
        assert!(b10 > b9);
        assert!(s030 > b10);
        assert!(b031 > s030);

        for invalid in [
            "",
            "0.3",
            "01.3.0",
            "0.3.0-alpha.1",
            "0.3.0-rc.1",
            "0.3.0-beta",
            "0.3.0-beta.0",
            "0.3.0-beta.01",
            "0.3.0+build1",
        ] {
            assert!(parse_product_version(invalid).is_err(), "should reject {invalid}");
        }
    }

    #[test]
    fn paginated_unordered_releases_filter_drafts_test_tags_and_contradictory_flags() {
        let page1 = serde_json::json!([
            { "id": 1, "tag_name": "v0.2.5", "draft": false, "prerelease": false, "assets": [] },
            { "id": 2, "tag_name": "update-test-v0.9.9", "draft": false, "prerelease": true, "assets": [] },
            { "id": 3, "tag_name": "v0.3.0-beta.9", "draft": false, "prerelease": true, "assets": [] },
            { "id": 4, "tag_name": "v0.3.0-rc.1", "draft": false, "prerelease": true, "assets": [] },
            { "id": 5, "tag_name": "v0.3.0-beta.11", "draft": true, "prerelease": true, "assets": [] }
        ]);
        let page2 = serde_json::json!([
            { "id": 6, "tag_name": "v0.3.0-beta.10", "draft": false, "prerelease": true, "assets": [] },
            // Contradictory tags: stable tag marked prerelease, and beta tag marked non-prerelease
            { "id": 7, "tag_name": "v0.4.0", "draft": false, "prerelease": true, "assets": [] },
            { "id": 8, "tag_name": "v0.3.0-beta.12", "draft": false, "prerelease": false, "assets": [] }
        ]);
        let slurped = serde_json::to_vec(&vec![page1, page2]).unwrap();
        let all = parse_release_list(&slurped).unwrap();
        assert_eq!(all.len(), 8);

        let (stable_rel, stable_ver) =
            select_release_candidate(&all, Channel::Stable, UpdateIntent::Upgrade).unwrap();
        assert_eq!(stable_rel.tag_name, "v0.2.5");
        assert_eq!(stable_ver.to_string(), "0.2.5");

        let (beta_rel, beta_ver) =
            select_release_candidate(&all, Channel::Beta, UpdateIntent::Upgrade).unwrap();
        assert_eq!(beta_rel.tag_name, "v0.3.0-beta.10");
        assert_eq!(beta_ver.to_string(), "0.3.0-beta.10");

        // When stable v0.3.0 is published, Beta channel picks v0.3.0 over v0.3.0-beta.10.
        let mut with_stable_030 = all.clone();
        with_stable_030.push(release(9, "v0.3.0", false, false));
        let (_, picked) =
            select_release_candidate(&with_stable_030, Channel::Beta, UpdateIntent::Upgrade).unwrap();
        assert_eq!(picked.to_string(), "0.3.0");
    }

    #[test]
    fn manifest_validation_checks_version_match_channel_contradiction_and_legacy_compatibility_table() {
        let repository = "owner/project";
        let current_beta = parse_product_version("0.3.0-beta.2").unwrap();
        let target_v025 = parse_product_version("0.2.5").unwrap();
        let target_v024 = parse_product_version("0.2.4").unwrap();
        let target_b2 = parse_product_version("0.3.0-beta.2").unwrap();

        // 1. Legacy v0.2.5 without monorail namespace is admitted via explicit audited table.
        let legacy_025_manifest = serde_json::to_vec(&serde_json::json!({
            "version": "0.2.5",
            "notes": "0.2.5 notes",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://api.github.com/repos/owner/project/releases/assets/42",
                    "signature": "sig-content"
                }
            }
        }))
        .unwrap();
        let (_, compat_025) = validate_manifest_and_compatibility(
            &legacy_025_manifest,
            &target_v025,
            false,
            repository,
            &current_beta,
        )
        .unwrap();
        assert!(compat_025.compatible);
        assert_eq!(compat_025.source, "auditedTable");

        // 2. Unaudited legacy v0.2.4 without monorail namespace is blocked from downgrade.
        let legacy_024_manifest = serde_json::to_vec(&serde_json::json!({
            "version": "0.2.4",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://api.github.com/repos/owner/project/releases/assets/41",
                    "signature": "sig-content"
                }
            }
        }))
        .unwrap();
        let (_, compat_024) = validate_manifest_and_compatibility(
            &legacy_024_manifest,
            &target_v024,
            false,
            repository,
            &current_beta,
        )
        .unwrap();
        assert!(!compat_024.compatible);
        assert_eq!(compat_024.source, "unverifiedMissingMetadata");

        // 2b. Future higher stable (0.3.0) or higher beta (0.3.0-beta.3) missing monorail metadata must ALSO be marked unverified and incompatible (R5).
        for higher_raw in ["0.3.0", "0.3.0-beta.3", "0.4.0"] {
            let target_higher = parse_product_version(higher_raw).unwrap();
            let missing_meta_higher = serde_json::to_vec(&serde_json::json!({
                "version": higher_raw,
                "platforms": {
                    "windows-x86_64": {
                        "url": "https://api.github.com/repos/owner/project/releases/assets/88",
                        "signature": "sig-content"
                    }
                }
            }))
            .unwrap();
            let (_, compat_higher) = validate_manifest_and_compatibility(
                &missing_meta_higher,
                &target_higher,
                false,
                repository,
                &current_beta,
            )
            .unwrap();
            assert!(
                !compat_higher.compatible,
                "higher version {higher_raw} without monorail metadata must not default to compatible"
            );
            assert_eq!(compat_higher.source, "unverifiedMissingMetadata");
        }

        // 3. Contradictory monorail.channel in manifest is rejected with an error.
        let contradictory_manifest = serde_json::to_vec(&serde_json::json!({
            "version": "0.3.0-beta.2",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://api.github.com/repos/owner/project/releases/assets/50",
                    "signature": "sig-content"
                }
            },
            "monorail": {
                "channel": "stable",
                "dataSchemaVersion": 2,
                "readableDataSchemaVersions": [2]
            }
        }))
        .unwrap();
        assert!(validate_manifest_and_compatibility(
            &contradictory_manifest,
            &target_b2,
            false,
            repository,
            &current_beta
        )
        .is_err());

        // 4. Mismatched manifest.version vs tag is rejected.
        assert!(validate_manifest_and_compatibility(
            &legacy_025_manifest,
            &target_v024,
            false,
            repository,
            &current_beta
        )
        .is_err());
    }

    #[test]
    fn single_target_comparator_allows_downgrade_only_for_permitted_compatible_stable_target() {
        // Normal upgrade never downgrades (0.3.0-beta.2 -> 0.2.5 or 0.3.0 -> 0.3.0-beta.9).
        assert!(!should_accept_remote_version(
            "0.3.0-beta.2",
            "0.2.5",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::Upgrade,
            true
        ));
        assert!(!should_accept_remote_version(
            "0.3.0",
            "0.3.0-beta.9",
            "0.3.0-beta.9",
            Channel::Beta,
            UpdateIntent::Upgrade,
            true
        ));
        // Normal upgrade accepts 0.3.0-beta.2 -> 0.3.0.
        assert!(should_accept_remote_version(
            "0.3.0-beta.2",
            "0.3.0",
            "0.3.0",
            Channel::Stable,
            UpdateIntent::Upgrade,
            true
        ));
        // Explicit ReturnToStable accepts ONLY the permitted compatible stable version.
        assert!(should_accept_remote_version(
            "0.3.0-beta.2",
            "0.2.5",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            true
        ));
        // Rejects a different remote version even during ReturnToStable.
        assert!(!should_accept_remote_version(
            "0.3.0-beta.2",
            "0.2.4",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            true
        ));
        // Rejects incompatible target.
        assert!(!should_accept_remote_version(
            "0.3.0-beta.2",
            "0.2.5",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            false
        ));
    }
}

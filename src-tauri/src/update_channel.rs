use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};

pub const CHANNEL_FILE: &str = "update-channel.json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Channel {
    #[default]
    Stable,
    Beta,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateIntent {
    #[default]
    Upgrade,
    ReturnToStable,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedChannel {
    channel: Channel,
    #[serde(default)]
    updated_at: u64,
}

pub fn derive_build_channel(version: &str) -> Channel {
    let core = version.split('+').next().unwrap_or(version);
    if let Some((_, prerelease)) = core.split_once('-') {
        if prerelease.starts_with("beta.") {
            return Channel::Beta;
        }
    }
    Channel::Stable
}

pub fn read_channel_from_dir(config_dir: &Path) -> Result<Channel, String> {
    let path = config_dir.join(CHANNEL_FILE);
    if !path.exists() {
        return Ok(Channel::Stable);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取更新渠道配置文件（{CHANNEL_FILE}）：{error}"))?;
    let parsed: PersistedChannel = serde_json::from_str(&raw)
        .map_err(|error| format!("更新渠道配置文件（{CHANNEL_FILE}）已损坏：{error}"))?;
    Ok(parsed.channel)
}

pub fn write_channel_to_dir(config_dir: &Path, channel: Channel, updated_at: u64) -> Result<(), String> {
    fs::create_dir_all(config_dir)
        .map_err(|error| format!("无法创建应用配置目录：{error}"))?;
    let temp = config_dir.join("update-channel.tmp");
    let target = config_dir.join(CHANNEL_FILE);
    let payload = serde_json::to_vec_pretty(&PersistedChannel { channel, updated_at })
        .map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temp)
        .map_err(|error| format!("无法写入更新渠道临时文件：{error}"))?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("无法同步更新渠道配置：{error}"))?;
    drop(file);
    fs::rename(&temp, &target)
        .map_err(|error| format!("无法原子更新渠道配置文件（{CHANNEL_FILE}）：{error}"))
}

pub fn read_channel(app: &tauri::AppHandle) -> Result<Channel, String> {
    let dir = super::config_dir(app)?;
    read_channel_from_dir(&dir)
}

pub fn write_channel(app: &tauri::AppHandle, channel: Channel) -> Result<(), String> {
    let dir = super::config_dir(app)?;
    write_channel_to_dir(&dir, channel, super::power::now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("monorail-channel-test-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_channel_file_defaults_to_stable_without_auto_enrolling_beta_builds() {
        let dir = temp_dir("missing");
        assert_eq!(read_channel_from_dir(&dir).unwrap(), Channel::Stable);
        assert_eq!(derive_build_channel("0.3.0-beta.1"), Channel::Beta);
        assert_eq!(derive_build_channel("0.3.0"), Channel::Stable);
        assert_eq!(derive_build_channel("0.2.5"), Channel::Stable);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn channel_preference_persists_atomically_across_restarts() {
        let dir = temp_dir("persist");
        write_channel_to_dir(&dir, Channel::Beta, 100).unwrap();
        assert_eq!(read_channel_from_dir(&dir).unwrap(), Channel::Beta);
        write_channel_to_dir(&dir, Channel::Stable, 200).unwrap();
        assert_eq!(read_channel_from_dir(&dir).unwrap(), Channel::Stable);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupted_channel_file_reports_explicit_error_instead_of_silently_resetting() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(CHANNEL_FILE), "{not-json").unwrap();
        let err = read_channel_from_dir(&dir).unwrap_err();
        assert!(err.contains(CHANNEL_FILE), "{err}");

        fs::write(dir.join(CHANNEL_FILE), r#"{"channel":"nightly"}"#).unwrap();
        let err2 = read_channel_from_dir(&dir).unwrap_err();
        assert!(err2.contains(CHANNEL_FILE), "{err2}");

        fs::write(dir.join(CHANNEL_FILE), r#"{"channel":"beta","extra":true}"#).unwrap();
        let err3 = read_channel_from_dir(&dir).unwrap_err();
        assert!(err3.contains(CHANNEL_FILE), "{err3}");
        let _ = fs::remove_dir_all(dir);
    }
}

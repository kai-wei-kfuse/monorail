use serde::Serialize;
use std::{fs, io::Write, path::Path};

// 回看页记住的选择（0.3.0-beta.3 D7，执行方案 E7 第 4 条）：这台电脑上的界面偏好，存在应用配置目录，
// 不进 settings.yaml、不进数据目录、不经提交队列。字段的取值由前端校验（非法字段回落默认值），
// 这里只管原子读写：文件缺失给 null；文件损坏给 null 并标 corrupt，让回看页提示一次，不静默。
pub const VIEW_FILE: &str = "recap-view.json";
/// 记住的只有几个短字段；限制大小，免得被当成任意存储用。
const MAX_BYTES: usize = 4096;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecapViewRead {
    value: Option<serde_json::Value>,
    corrupt: bool,
}

pub fn read_from_dir(dir: &Path) -> Result<RecapViewRead, String> {
    let raw = match fs::read(dir.join(VIEW_FILE)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(RecapViewRead { value: None, corrupt: false }),
        Err(error) => return Err(format!("无法读取回看设置（{VIEW_FILE}）：{error}")),
    };
    match serde_json::from_slice::<serde_json::Value>(&raw) {
        Ok(value) if value.is_object() => Ok(RecapViewRead { value: Some(value), corrupt: false }),
        _ => Ok(RecapViewRead { value: None, corrupt: true }),
    }
}

pub fn write_to_dir(dir: &Path, value: &serde_json::Value) -> Result<(), String> {
    if !value.is_object() { return Err("回看设置必须是一个对象".into()); }
    let payload = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if payload.len() > MAX_BYTES { return Err("回看设置太大".into()); }
    fs::create_dir_all(dir).map_err(|e| format!("无法创建应用配置目录：{e}"))?;
    let temp = dir.join("recap-view.tmp");
    let mut file = fs::File::create(&temp).map_err(|e| format!("无法写入回看设置临时文件：{e}"))?;
    file.write_all(&payload).and_then(|_| file.sync_all()).map_err(|e| format!("无法同步回看设置：{e}"))?;
    drop(file);
    fs::rename(&temp, dir.join(VIEW_FILE)).map_err(|e| format!("无法原子更新回看设置（{VIEW_FILE}）：{e}"))
}

#[tauri::command]
pub fn read_recap_view(app: tauri::AppHandle) -> Result<RecapViewRead, String> {
    read_from_dir(&super::config_dir(&app)?)
}

#[tauri::command]
pub fn write_recap_view(app: tauri::AppHandle, value: serde_json::Value) -> Result<(), String> {
    write_to_dir(&super::config_dir(&app)?, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("monorail-recap-view-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_reads_as_defaults_without_a_notice() {
        let dir = temp_dir("missing");
        assert_eq!(read_from_dir(&dir).unwrap(), RecapViewRead { value: None, corrupt: false });
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_file_reads_as_defaults_and_is_reported() {
        let dir = temp_dir("corrupt");
        for raw in ["{not-json", "[1,2]", "\"week\"", ""] {
            fs::write(dir.join(VIEW_FILE), raw).unwrap();
            assert_eq!(read_from_dir(&dir).unwrap(), RecapViewRead { value: None, corrupt: true }, "{raw}");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn round_trip_replaces_the_file_atomically_and_rejects_non_objects() {
        let dir = temp_dir("round");
        let first = serde_json::json!({ "period": "custom", "from": "2026-10-20", "to": "2026-11-04", "dim": "tag", "includeIdle": true, "view": "list" });
        write_to_dir(&dir, &first).unwrap();
        assert_eq!(read_from_dir(&dir).unwrap(), RecapViewRead { value: Some(first), corrupt: false });
        let second = serde_json::json!({ "period": "week" });
        write_to_dir(&dir, &second).unwrap();
        assert_eq!(read_from_dir(&dir).unwrap().value, Some(second));
        assert!(!dir.join("recap-view.tmp").exists());
        assert!(write_to_dir(&dir, &serde_json::json!([1])).is_err());
        assert!(write_to_dir(&dir, &serde_json::json!({ "x": "y".repeat(5000) })).is_err());
        assert_eq!(read_from_dir(&dir).unwrap().value, Some(serde_json::json!({ "period": "week" })));
        let _ = fs::remove_dir_all(dir);
    }
}

use std::sync::atomic::{AtomicU64, Ordering};

// 主窗口会话世代（0.3.0-beta.3 D4，执行方案 E5）：主窗口每次 bootstrap（含 F5、更换数据目录后的重载）取一次，
// 进程内单调递增。前端重载不会重置它；Rust 进程重启时小窗也随之重建，从头计数没有问题。
// 小窗按 (epoch, revision) 比较快照新旧，主窗口拒绝 epoch 不符的命令。
static EPOCH: AtomicU64 = AtomicU64::new(0);

fn next() -> u64 { EPOCH.fetch_add(1, Ordering::SeqCst) + 1 }

pub fn current_main_epoch() -> u64 { EPOCH.load(Ordering::SeqCst).max(1) }

#[tauri::command]
pub fn begin_main_session() -> u64 { next() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epochs_are_positive_and_strictly_increasing_even_across_threads() {
        let first = next();
        assert!(first >= 1);
        let handles: Vec<_> = (0..8).map(|_| std::thread::spawn(|| (0..100).map(|_| next()).collect::<Vec<_>>())).collect();
        let mut all: Vec<u64> = handles.into_iter().flat_map(|h| h.join().unwrap()).collect();
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), 800, "every call gets its own epoch");
        assert!(all[0] > first);
        assert!(next() > *all.last().unwrap());
    }
}

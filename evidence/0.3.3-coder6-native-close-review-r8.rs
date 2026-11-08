use super::*;
use std::cell::Cell;

fn two_windows() -> (IdeaWindows, IdeaWindowRegistration, IdeaWindowRegistration) {
    let state = IdeaWindows::default();
    let (a, b) = {
        let mut reg = state.0.lock().unwrap();
        (
            reg.register_record_window("123e4567-e89b-12d3-a456-426614174000", 4, None)
                .unwrap(),
            reg.register_record_window("123e4567-e89b-12d3-a456-426614174001", 4, None)
                .unwrap(),
        )
    };
    (state, a, b)
}

#[test]
fn failed_native_destroy_keeps_both_exact_registrations_and_clears_closing_marker() {
    let (state, a, b) = two_windows();
    let error = destroy_registered_window(&state, &a.window_label, || {
        Err("controlled-native-destroy-failed".into())
    })
    .unwrap_err();
    assert!(error.contains("controlled-native-destroy-failed"));
    let reg = state.0.lock().unwrap();
    assert_eq!(reg.windows.get(&a.window_label), Some(&a));
    assert_eq!(reg.windows.get(&b.window_label), Some(&b));
    assert!(reg.closing.is_empty());
}

#[test]
fn successful_destroy_runs_without_holding_registry_lock_and_removes_only_its_target() {
    let (state, a, b) = two_windows();
    destroy_registered_window(&state, &a.window_label, || {
        // A synchronous native Destroyed callback must be able to acquire this lock.
        let reg = state
            .0
            .try_lock()
            .expect("registry lock held during native destroy");
        assert_eq!(reg.windows.get(&a.window_label), Some(&a));
        assert!(reg.closing.contains(&a.window_label));
        Ok(())
    })
    .unwrap();
    let reg = state.0.lock().unwrap();
    assert!(!reg.windows.contains_key(&a.window_label));
    assert_eq!(reg.windows.get(&b.window_label), Some(&b));
    assert!(reg.closing.is_empty());
}

#[test]
fn unknown_target_fails_without_calling_native_destroy_or_changing_other_registrations() {
    let (state, a, b) = two_windows();
    let called = Cell::new(false);
    assert!(destroy_registered_window(&state, "idea-unknown", || {
        called.set(true);
        Ok(())
    })
    .is_err());
    assert!(!called.get());
    let reg = state.0.lock().unwrap();
    assert_eq!(reg.windows.get(&a.window_label), Some(&a));
    assert_eq!(reg.windows.get(&b.window_label), Some(&b));
    assert!(reg.closing.is_empty());
}

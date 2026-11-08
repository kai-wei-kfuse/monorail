use super::*;
use std::sync::mpsc::{self, Receiver, TryRecvError};

fn pending_round(request_id: &str) -> (Gate, Receiver<Result<Option<DraftCheckResponse>, String>>) {
    let (sender, receiver) = mpsc::channel();
    let gate = Gate {
        installing: true,
        active_check_request_id: Some(request_id.into()),
        active_check_targets: vec!["main".into(), "idea-a".into()],
        pending_check: Some(PendingDraftCheck {
            request_id: request_id.into(),
            expected: ["main".to_string(), "idea-a".to_string()]
                .into_iter()
                .collect(),
            responses: HashMap::new(),
            sender,
        }),
        ..Gate::default()
    };
    (gate, receiver)
}

fn ack(gate: &mut Gate, caller: &str, request_id: &str, dirty: bool) -> Result<(), String> {
    gate.record_ack(caller.into(), Some(request_id), dirty, false, None)
}

#[test]
fn old_round_ack_does_not_advance_the_new_round() {
    let (mut gate, receiver) = pending_round("dc-new");
    assert!(ack(&mut gate, "main", "dc-old", false).is_err());
    assert!(gate.pending_check.as_ref().unwrap().responses.is_empty());
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    ack(&mut gate, "main", "dc-new", true).unwrap();
    ack(&mut gate, "idea-a", "dc-new", false).unwrap();
    let dirty = receiver.try_recv().unwrap().unwrap().unwrap();
    assert_eq!(dirty.window_label, "main");
}

#[test]
fn a_missing_request_token_never_counts_as_a_response() {
    let (mut gate, receiver) = pending_round("dc-current");
    assert!(gate
        .record_ack("main".into(), None, false, false, None)
        .is_err());
    assert!(gate.pending_check.as_ref().unwrap().responses.is_empty());
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn empty_request_token_never_counts_as_a_response() {
    let (mut gate, receiver) = pending_round("dc-current");
    assert!(ack(&mut gate, "main", "", false).is_err());
    assert!(gate.pending_check.as_ref().unwrap().responses.is_empty());
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn a_duplicate_clean_ack_cannot_replace_the_first_dirty_response() {
    let (mut gate, receiver) = pending_round("dc-current");
    ack(&mut gate, "main", "dc-current", true).unwrap();
    ack(&mut gate, "main", "dc-current", false).unwrap();
    assert!(gate.pending_check.as_ref().unwrap().responses["main"].dirty);
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    ack(&mut gate, "idea-a", "dc-current", false).unwrap();
    let dirty = receiver.try_recv().unwrap().unwrap().unwrap();
    assert_eq!(dirty.window_label, "main");
}

#[test]
fn an_unexpected_caller_does_not_satisfy_an_expected_window() {
    let (mut gate, receiver) = pending_round("dc-current");
    assert!(ack(&mut gate, "idea-b", "dc-current", false).is_err());
    assert!(gate.pending_check.as_ref().unwrap().responses.is_empty());
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    ack(&mut gate, "main", "dc-current", false).unwrap();
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    ack(&mut gate, "idea-a", "dc-current", false).unwrap();
    assert!(receiver.try_recv().unwrap().unwrap().is_none());
}

#[test]
fn a_second_begin_does_not_replace_an_in_progress_round() {
    let (mut gate, receiver) = pending_round("dc-original");
    let expected = ["main".to_string()].into_iter().collect();
    let _second = gate.begin_check("dc-second".into(), expected);
    assert_eq!(gate.active_check_request_id.as_deref(), Some("dc-original"));
    assert_eq!(
        gate.pending_check.as_ref().unwrap().request_id,
        "dc-original"
    );
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    ack(&mut gate, "main", "dc-original", true).unwrap();
    ack(&mut gate, "idea-a", "dc-original", false).unwrap();
    assert!(receiver.try_recv().unwrap().unwrap().is_some());
}

#[test]
fn stale_cancel_does_not_unlock_the_current_round() {
    let (mut gate, receiver) = pending_round("dc-current");
    assert!(gate.cancel_check(Some("dc-old")).is_err());
    assert!(gate.installing);
    assert_eq!(gate.active_check_request_id.as_deref(), Some("dc-current"));
    assert!(gate.pending_check.as_ref().unwrap().responses.is_empty());
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn unbound_cancel_cannot_cancel_someone_elses_current_round() {
    let (mut gate, receiver) = pending_round("dc-current");
    assert!(gate.cancel_check(None).is_err());
    assert!(gate.installing);
    assert_eq!(gate.active_check_request_id.as_deref(), Some("dc-current"));
    assert!(gate.pending_check.as_ref().unwrap().responses.is_empty());
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn only_a_completed_clean_round_can_authorize_exit_and_cancel_revokes_it() {
    let (mut gate, receiver) = pending_round("dc-clean");
    assert!(gate.verify_clean_round("dc-clean").is_err());
    ack(&mut gate, "main", "dc-clean", false).unwrap();
    assert!(gate.verify_clean_round("dc-clean").is_err());
    ack(&mut gate, "idea-a", "dc-clean", false).unwrap();
    assert!(receiver.try_recv().unwrap().unwrap().is_none());
    gate.verify_clean_round("dc-clean").unwrap();
    assert!(gate.verify_clean_round("dc-other").is_err());
    gate.cancel_check(Some("dc-clean")).unwrap();
    assert!(gate.verify_clean_round("dc-clean").is_err());
}

#[test]
fn a_completed_dirty_round_never_authorizes_exit() {
    let (mut gate, receiver) = pending_round("dc-dirty");
    ack(&mut gate, "main", "dc-dirty", false).unwrap();
    ack(&mut gate, "idea-a", "dc-dirty", true).unwrap();
    assert!(receiver.try_recv().unwrap().unwrap().is_some());
    assert!(gate.verify_clean_round("dc-dirty").is_err());
}

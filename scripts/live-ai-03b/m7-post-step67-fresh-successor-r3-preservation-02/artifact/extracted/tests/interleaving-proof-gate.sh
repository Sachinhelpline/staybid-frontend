#!/usr/bin/env bash
# R3 fail-closed single-observation proof gates.
# No state is accumulated across observations. A pre-expiry proof exists only
# when ONE row simultaneously proves the complete conjunction.

m7_r3_is_uint() {
  case "${1:-}" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# Args:
#   1: single pipe-delimited observation row
#   2: expected exact blocker PID
#   3: expected expiry text
# Row fields:
# activation_pid|observer_pid|blocker_pid|state|wait_event_type|wait_event|
# before_expiry|exact_blocker|blocking_pid_count|observed_at|expiry_text
m7_r3_pre_observation_gate() {
  if [ "$#" -ne 3 ]; then
    echo "R3_PRE_GATE_BAD_ARITY:$#" >&2
    return 64
  fi
  local row="$1" expected_blocker="$2" expected_expiry="$3"
  local activation_pid observer_pid blocker_pid state wtype wevent before_exp exact_blocker blocker_count observed_at expiry_text extra
  IFS='|' read -r activation_pid observer_pid blocker_pid state wtype wevent before_exp exact_blocker blocker_count observed_at expiry_text extra <<EOF_ROW
$row
EOF_ROW

  [ -z "${extra:-}" ] || { echo "R3_PRE_GATE_REFUSED:extra_fields" >&2; return 66; }
  m7_r3_is_uint "$activation_pid" || { echo "R3_PRE_GATE_REFUSED:activation_pid" >&2; return 66; }
  m7_r3_is_uint "$observer_pid" || { echo "R3_PRE_GATE_REFUSED:observer_pid" >&2; return 66; }
  m7_r3_is_uint "$blocker_pid" || { echo "R3_PRE_GATE_REFUSED:blocker_pid" >&2; return 66; }
  m7_r3_is_uint "$expected_blocker" || { echo "R3_PRE_GATE_REFUSED:expected_blocker" >&2; return 66; }
  [ "$blocker_pid" = "$expected_blocker" ] || { echo "R3_PRE_GATE_REFUSED:wrong_blocker_pid" >&2; return 66; }
  [ "$activation_pid" != "$blocker_pid" ] || { echo "R3_PRE_GATE_REFUSED:activation_equals_blocker" >&2; return 66; }
  [ "$activation_pid" != "$observer_pid" ] || { echo "R3_PRE_GATE_REFUSED:activation_equals_observer" >&2; return 66; }
  [ "$blocker_pid" != "$observer_pid" ] || { echo "R3_PRE_GATE_REFUSED:blocker_equals_observer" >&2; return 66; }
  [ "$state" = "active" ] || { echo "R3_PRE_GATE_REFUSED:not_active" >&2; return 66; }
  [ "$wtype" = "Lock" ] || { echo "R3_PRE_GATE_REFUSED:not_lock_wait" >&2; return 66; }
  [ "$before_exp" = "1" ] || { echo "R3_PRE_GATE_REFUSED:not_pre_expiry" >&2; return 66; }
  [ "$exact_blocker" = "1" ] || { echo "R3_PRE_GATE_REFUSED:exact_blocker_absent" >&2; return 66; }
  [ "$blocker_count" = "1" ] || { echo "R3_PRE_GATE_REFUSED:blocker_count=$blocker_count" >&2; return 66; }
  [ -n "$observed_at" ] || { echo "R3_PRE_GATE_REFUSED:observed_at_missing" >&2; return 66; }
  [ "$expiry_text" = "$expected_expiry" ] || { echo "R3_PRE_GATE_REFUSED:expiry_mismatch" >&2; return 66; }
  echo "R3_PRE_GATE_PASS activation_pid=$activation_pid blocker_pid=$blocker_pid observer_pid=$observer_pid observed_at=$observed_at expiry=$expiry_text wait_event=$wevent"
  return 0
}

# Same row shape as pre gate except field 7 is at_or_after_expiry.
# Args: row, expected activation PID, expected blocker PID, expected expiry text.
m7_r3_post_observation_gate() {
  if [ "$#" -ne 4 ]; then
    echo "R3_POST_GATE_BAD_ARITY:$#" >&2
    return 64
  fi
  local row="$1" expected_activation="$2" expected_blocker="$3" expected_expiry="$4"
  local activation_pid observer_pid blocker_pid state wtype wevent expired exact_blocker blocker_count observed_at expiry_text extra
  IFS='|' read -r activation_pid observer_pid blocker_pid state wtype wevent expired exact_blocker blocker_count observed_at expiry_text extra <<EOF_ROW
$row
EOF_ROW

  [ -z "${extra:-}" ] || { echo "R3_POST_GATE_REFUSED:extra_fields" >&2; return 66; }
  m7_r3_is_uint "$activation_pid" || { echo "R3_POST_GATE_REFUSED:activation_pid" >&2; return 66; }
  m7_r3_is_uint "$observer_pid" || { echo "R3_POST_GATE_REFUSED:observer_pid" >&2; return 66; }
  m7_r3_is_uint "$blocker_pid" || { echo "R3_POST_GATE_REFUSED:blocker_pid" >&2; return 66; }
  [ "$activation_pid" = "$expected_activation" ] || { echo "R3_POST_GATE_REFUSED:wrong_activation_pid" >&2; return 66; }
  [ "$blocker_pid" = "$expected_blocker" ] || { echo "R3_POST_GATE_REFUSED:wrong_blocker_pid" >&2; return 66; }
  [ "$activation_pid" != "$blocker_pid" ] || { echo "R3_POST_GATE_REFUSED:activation_equals_blocker" >&2; return 66; }
  [ "$activation_pid" != "$observer_pid" ] || { echo "R3_POST_GATE_REFUSED:activation_equals_observer" >&2; return 66; }
  [ "$blocker_pid" != "$observer_pid" ] || { echo "R3_POST_GATE_REFUSED:blocker_equals_observer" >&2; return 66; }
  [ "$state" = "active" ] || { echo "R3_POST_GATE_REFUSED:not_active" >&2; return 66; }
  [ "$wtype" = "Lock" ] || { echo "R3_POST_GATE_REFUSED:not_lock_wait" >&2; return 66; }
  [ "$expired" = "1" ] || { echo "R3_POST_GATE_REFUSED:not_post_expiry" >&2; return 66; }
  [ "$exact_blocker" = "1" ] || { echo "R3_POST_GATE_REFUSED:exact_blocker_absent" >&2; return 66; }
  [ "$blocker_count" = "1" ] || { echo "R3_POST_GATE_REFUSED:blocker_count=$blocker_count" >&2; return 66; }
  [ -n "$observed_at" ] || { echo "R3_POST_GATE_REFUSED:observed_at_missing" >&2; return 66; }
  [ "$expiry_text" = "$expected_expiry" ] || { echo "R3_POST_GATE_REFUSED:expiry_mismatch" >&2; return 66; }
  echo "R3_POST_GATE_PASS activation_pid=$activation_pid blocker_pid=$blocker_pid observer_pid=$observer_pid observed_at=$observed_at expiry=$expiry_text wait_event=$wevent"
  return 0
}

# Final gate cannot manufacture a missing pre/post observation.
m7_r3_completion_gate() {
  if [ "$#" -ne 4 ]; then
    echo "R3_COMPLETION_GATE_BAD_ARITY:$#" >&2
    return 64
  fi
  local pre="$1" post="$2" freshness="$3" rollback="$4"
  [ "$pre" = "1" ] || { echo "R3_COMPLETION_GATE_REFUSED:pre_observation=0" >&2; return 66; }
  [ "$post" = "1" ] || { echo "R3_COMPLETION_GATE_REFUSED:post_observation=0" >&2; return 66; }
  [ "$freshness" = "1" ] || { echo "R3_COMPLETION_GATE_REFUSED:freshness_refusal=0" >&2; return 66; }
  [ "$rollback" = "1" ] || { echo "R3_COMPLETION_GATE_REFUSED:rollback_clean=0" >&2; return 66; }
  echo "R3_COMPLETION_GATE_PASS"
  return 0
}

import { EVENT_STEPS, ORIGINAL_LOAD, workloadAt, workloadPreset } from '../workload-model.js';

const plan = ORIGINAL_LOAD;
const waitingPlan = workloadPreset('queue');
const snapshot = (setup, event) => workloadAt(setup, event * EVENT_STEPS);

// Share the incoming request's full context allowance equally between the two active chats.
const trimPerChat = plan.c / 2;
const trimmedPlan = { ...plan, a: plan.a - trimPerChat, b: plan.b - trimPerChat };
const initial = snapshot(plan, plan.arrival);
export const scenario = Object.freeze({
  plan, trimPerChat,
  initial,
  demand: snapshot(plan, plan.arrival + 1),
  trimmed: snapshot(trimmedPlan, plan.arrival + 1),
  afterRelease: snapshot(waitingPlan, waitingPlan.arrival + 1),
  incomingCapacity: workloadPreset('trim').c
});

import { getNodeRun, getTask, recoverOrphans, type OrphanRecovery } from "./taskService.js";
import { getTeamRun } from "./teamRunService.js";
import { broadcastNodeFinished, broadcastTaskUpdated, broadcastTeamRunUpdated } from "./wsService.js";

/** A8a: recovers orphans and tells connected GUIs about every row it changed. */
export async function recoverAndBroadcastOrphans(): Promise<OrphanRecovery> {
  const result = recoverOrphans();
  for (const id of [...result.taskIds, ...result.resolvingTaskIds]) {
    const task = await getTask(id);
    if (task) broadcastTaskUpdated(task);
  }
  for (const id of result.runIds) {
    const run = getTeamRun(id);
    if (run) broadcastTeamRunUpdated(run);
  }
  for (const id of result.nodeRunIds) {
    const nodeRun = getNodeRun(id);
    if (nodeRun) broadcastNodeFinished(nodeRun);
  }
  return result;
}

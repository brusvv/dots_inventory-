/**
 * D-09 runtime acceptance fixture.
 *
 * This deliberately tiny module verifies the complete-file-set installer:
 * - first YES install must create this file;
 * - a later YES install must update its revision;
 * - NO/cancel must leave the currently installed revision untouched.
 *
 * It is read-only: it does not write Script Properties, Drive, spreadsheet
 * data, triggers, deployments, or any other project files.
 */
var DI3_GITHUB_INSTALL_LIFECYCLE_PROBE_REVISION = "D09-PROBE-V2";

function di3RunGitHubInstallLifecycleProbe() {
  return {
    status: "PROBE_OK",
    fixture: "DI3_GITHUB_INSTALL_LIFECYCLE_PROBE",
    revision: DI3_GITHUB_INSTALL_LIFECYCLE_PROBE_REVISION,
    script_id: ScriptApp.getScriptId(),
    executed_at: new Date().toISOString(),
    note: "Read-only probe; no project or spreadsheet state was changed."
  };
}

export const state = {
  credentials: null,
  locked: false,
  saveResult: true,
  saves: [],
  releases: 0,
};
export async function getBackgroundCredentials() {
  return state.credentials;
}
export async function acquireJob() {
  if (state.locked) return false;
  state.locked = true;
  return true;
}
export async function finishJob() {
  state.locked = false;
  state.releases++;
}
export async function saveRefreshedCredentials(previous, next) {
  state.saves.push({ previous, next });
  return state.saveResult;
}
export function reset() {
  Object.assign(state, {
    credentials: null,
    locked: false,
    saveResult: true,
    saves: [],
    releases: 0,
  });
}

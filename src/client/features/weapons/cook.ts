/**
 * Cook timer bookkeeping for the HUD (pure, no DOM): which local time a cookable grenade's fuse
 * runs from. The fuse maths itself (`cookLeft`, `cookWarning`, `cookTicksBetween`) is shared with
 * the server in `shared/defs/equipment.ts`.
 *
 * The client predicts the cook from the frame whose input carried the LETHAL press. The server
 * acks with the seq of the command it pulled the pin on (`weapons.cook`); that seq maps back to
 * the local time of the frame that sent it, which is where the server's fuse starts on the same
 * input timeline: a release sent before `since + fuse` (local) reaches the server before the fuse.
 */

/** One frame of input history: the last seq the frame sent and its local time. */
export interface FrameSeq {
  seq: number;
  t: number;
}

/** Keep this many frames (a few seconds at 60 fps; acks come back within one round trip). */
export const FRAME_HISTORY = 360;

/**
 * Local time of the input frame that sent command `seq`: the first frame (oldest first) whose last
 * seq reaches it, or null when it is newer than every recorded frame or older than the history.
 */
export function frameTimeOfSeq(frames: readonly FrameSeq[], seq: number): number | null {
  // A frame sends at most 5 commands (0.25 s split into 0.05 s), so older seqs predate the history.
  if (!frames.length || seq <= frames[0]!.seq - 5) return null;
  for (const f of frames) if (f.seq >= seq) return f.t;
  return null;
}

/** Record a frame (call once per frame after its input went out), trimming old history. */
export function pushFrame(frames: FrameSeq[], seq: number, t: number): void {
  const last = frames[frames.length - 1];
  if (last && last.seq === seq) return; // no new input this frame
  frames.push({ seq, t });
  if (frames.length > FRAME_HISTORY) frames.splice(0, frames.length - FRAME_HISTORY);
}

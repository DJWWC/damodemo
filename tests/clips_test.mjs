import * as C from "../docs/clips.js";
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg); };
const K = 1000;                                                  // 1 unit = 1000 samples, so 5 ms fades stay near edges
const src = new Float32Array(100 * K).map((_, i) => i + 1);      // value = index + 1
const sources = new Map([["s", src]]);
const at = (clips, u) => C.flatten(clips, sources)[Math.round(u * K)];
const v = (u) => Math.round(u * K) + 1;                          // expected source value at unit u
const noOverlap = (cl) => cl.every((c, i, a) => i === 0 || a[i - 1].pos + a[i - 1].len <= c.pos);
const clips = C.wholeSource("s", 100 * K);

ok(at(clips, 50) === v(50), "whole source flattens unchanged");
const sp = C.splitAt(clips, 40 * K);
ok(sp.length === 2 && sp[0].len === 40 * K && sp[1].pos === 40 * K && sp[1].start === 40 * K, "split at 40 gives two clips");
ok(at(sp, 10) === v(10) && at(sp, 80) === v(80), "split audio unchanged away from the cut");
const fs = C.flatten(sp, sources);
ok(fs[40 * K - 1] < 1 && fs[40 * K] === 0 && fs[40 * K - 300] === 40 * K - 299, "5 ms fades only at the cut edge");

const rm = C.removeRange(clips, 20 * K, 30 * K);
ok(rm.length === 2 && at(rm, 25) === 0 && at(rm, 10) === v(10) && at(rm, 40) === v(40), "cut [20,30) leaves a gap, rest intact");
const board = C.extract(clips, 10 * K, 20 * K);
ok(board.len === 10 * K && board.clips[0].start === 10 * K && board.clips[0].pos === 0, "copy [10,20) to clipboard");
const ps = C.paste(clips, board, 60 * K);
ok(at(ps, 65) === v(15) && at(ps, 50) === v(50) && at(ps, 75) === v(75), "paste at 60 replaces 60-70 with 10-20");
ok(noOverlap(ps), "no overlaps after paste");
const d = C.duplicate(clips, 0, 10 * K);
ok(at(d.clips, 15) === v(5) && d.pasted[0] === 10 * K && at(d.clips, 30) === v(30), "duplicate [0,10) right after itself");
const two = C.splitAt(clips, 50 * K);
const mv = C.moveClip(two, two[1].id, 70 * K);
ok(at(mv, 60) === 0 && at(mv, 75) === v(55) && C.flatten(mv, sources).length === 120 * K, "move clip later: gap, audio follows, length grows");
const mv2 = C.moveClip(two, two[1].id, 30 * K);
ok(at(mv2, 35) === v(55) && at(mv2, 10) === v(10), "move clip earlier replaces what it lands on");
ok(noOverlap(mv2), "no overlaps after move");
ok(C.nearest([0, 100, 200, 300], 190, 15) === 200 && C.nearest([0, 100, 200], 150, 10) === null, "snap finds nearest target within range");
console.log(fails ? `${fails} FAILED` : "all passed");

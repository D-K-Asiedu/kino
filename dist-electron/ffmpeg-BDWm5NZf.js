import u from "fluent-ffmpeg";
import h from "ffmpeg-static";
import P from "ffprobe-static";
import l from "path";
import { app as _ } from "electron";
var b;
const d = ((b = h) == null ? void 0 : b.replace("app.asar", "app.asar.unpacked")) || "", g = P.path.replace("app.asar", "app.asar.unpacked");
d && u.setFfmpegPath(d);
g && u.setFfprobePath(g);
async function F(a) {
  return new Promise((n, o) => {
    u.ffprobe(a, (e, i) => {
      if (e) {
        console.error("ffprobe error:", e), o(e);
        return;
      }
      const c = i.streams.filter((t) => t.codec_type === "audio").map((t, f) => {
        var r, p;
        return {
          index: t.index,
          language: ((r = t.tags) == null ? void 0 : r.language) || "und",
          label: ((p = t.tags) == null ? void 0 : p.title) || `Audio ${f + 1}`,
          codec: t.codec_name || "unknown",
          channels: t.channels || 2
        };
      }), s = i.streams.filter((t) => t.codec_type === "subtitle").map((t, f) => {
        var r, p, m;
        return {
          index: t.index,
          language: ((r = t.tags) == null ? void 0 : r.language) || "und",
          label: ((p = t.tags) == null ? void 0 : p.title) || `Subtitle ${f + 1}`,
          codec: t.codec_name || "unknown",
          isDefault: ((m = t.disposition) == null ? void 0 : m.default) === 1
        };
      });
      n({ audioTracks: c, subtitleTracks: s });
    });
  });
}
async function w(a, n) {
  const o = _.getPath("temp"), e = l.join(o, `kino_sub_${l.basename(a)}_${n}.vtt`);
  return new Promise((i, c) => {
    u(a).output(e).outputOptions([
      `-map 0:${n}`,
      "-f webvtt",
      "-y"
    ]).on("end", () => i(e)).on("error", (s) => c(s)).run();
  });
}
async function S(a, n) {
  const o = await w(a, n);
  return (await import("fs/promises")).readFile(o, "utf-8");
}
export {
  w as extractSubtitle,
  S as extractSubtitleContent,
  F as getMediaMetadata
};

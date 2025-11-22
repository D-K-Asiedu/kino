var _a;
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath$1 from "ffmpeg-static";
import ffprobePath$1 from "ffprobe-static";
import "path";
import "electron";
const ffmpegPath = ((_a = ffmpegPath$1) == null ? void 0 : _a.replace("app.asar", "app.asar.unpacked")) || "";
const ffprobePath = ffprobePath$1.path.replace("app.asar", "app.asar.unpacked");
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
async function getMediaMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error("ffprobe error:", err);
        reject(err);
        return;
      }
      const audioTracks = metadata.streams.filter((s) => s.codec_type === "audio").map((s, i) => {
        var _a2, _b;
        return {
          index: s.index,
          language: ((_a2 = s.tags) == null ? void 0 : _a2.language) || "und",
          label: ((_b = s.tags) == null ? void 0 : _b.title) || `Audio ${i + 1}`,
          codec: s.codec_name || "unknown",
          channels: s.channels || 2
        };
      });
      const subtitleTracks = metadata.streams.filter((s) => s.codec_type === "subtitle").map((s, i) => {
        var _a2, _b, _c;
        return {
          index: s.index,
          language: ((_a2 = s.tags) == null ? void 0 : _a2.language) || "und",
          label: ((_b = s.tags) == null ? void 0 : _b.title) || `Subtitle ${i + 1}`,
          codec: s.codec_name || "unknown",
          isDefault: ((_c = s.disposition) == null ? void 0 : _c.default) === 1
        };
      });
      resolve({ audioTracks, subtitleTracks });
    });
  });
}
export {
  getMediaMetadata
};

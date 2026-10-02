# Cross-platform playback plan

Kino ships for Linux, Windows and macOS. The current conversion pipeline was built and tested only on Linux (Intel Iris Xe, a library of HEVC files ≤1080p). This plan covers the changes needed for it to work well on every platform, and how to test them on Windows.

Status: Phase 0 is done on Windows (2026-10-02). The baseline passes after three fixes, listed under [Phase 0 findings](#phase-0-findings). Phases 1–7 are not implemented yet. Work through them in order; each one ends with a test checklist.

## How playback works today

Read this first; file references are to the current code.

- **Probe** — [`electron/lib/media.ts`](../electron/lib/media.ts) `getMediaDetails()` runs ffprobe and decides:
  - `direct` — Chromium plays the file as-is through `media://` (plain file server in [`electron/main.ts`](../electron/main.ts)).
  - `transcode` with `copyVideo: true` — only the audio or container is unsupported. Served as one progressive fragmented MP4 from [`electron/lib/streaming.ts`](../electron/lib/streaming.ts) (`kino-stream://play/...`). The player offsets its clock by the keyframe the stream starts on (`media:resolve-stream-start`).
  - `transcode` with `copyVideo: false` (`hls: true`) — video is re-encoded and served as on-demand HLS from [`electron/lib/hls.ts`](../electron/lib/hls.ts) (`kino-stream://hls/...`), played with hls.js.
- **Supported codecs are hard-coded** in `media.ts`: video `h264` (8-bit only), `vp8`, `vp9`, `av1`; audio `aac`, `mp3`, `opus`, `vorbis`, `flac`; direct containers `.mp4 .m4v .mov .webm .mkv`.
- **Encoders** — [`electron/lib/encoders.ts`](../electron/lib/encoders.ts) test-runs the bundled ffmpeg and any system ffmpeg at startup and ranks what works: `h264_vaapi` > `vp9_vaapi` > `libx264`. A stream that produces no output falls back to the next profile. The chosen list is logged as `[stream] encoders: ...`.
- **HLS sessions** cache 3-second segments in `os.tmpdir()/kino-hls/<pid>/`. The encoder is paused with `SIGSTOP` when it gets 20 segments (~60s) ahead of the player, and resumed with `SIGCONT`. ffmpeg runs with the session folder as its working directory and writes relative file names (see Phase 0 findings). Segments are deleted when the player closes and when the app quits: `before-quit` waits up to 3s for `shutdownStreams()`. Folders left behind by a crash are removed the next time an HLS session starts.
- **Player** — [`src/components/VideoPlayer.tsx`](../src/components/VideoPlayer.tsx): `init` effect picks the mode, `startHlsAt` / `startStreamAt` start conversions, `toggleAudioTrack` switches tracks, the `<video onError>` handler shows errors.

## Phase 0 — Move to Windows and check what exists

Done on Windows 11 with the bundled ffmpeg (6.1.1, gyan.dev essentials build; only `libx264` passes encoder detection). Results are in the checklist and findings below.

On the Windows machine:

```powershell
git clone <repo> ; cd kino
npx -y yarn@1 install      # the repo uses a yarn v1 lockfile
npx -y yarn@1 dev          # vite + electron
```

`yarn install` downloads the **Windows** ffmpeg build (gyan.dev) into `node_modules/ffmpeg-static`. Check what it offers before Phase 4:

```powershell
node_modules\ffmpeg-static\ffmpeg.exe -hide_banner -encoders | findstr /i "nvenc qsv amf mf x264"
node_modules\ffmpeg-static\ffmpeg.exe -hide_banner -hwaccels
```

Make a test media folder (none of the Linux library comes along). Commands that work with the bundled ffmpeg — run in the folder you add to Kino's library:

```powershell
$ff = "<repo>\node_modules\ffmpeg-static\ffmpeg.exe"
# HEVC 8-bit + E-AC3 (most common "unsupported" file)
& $ff -f lavfi -i testsrc2=s=1920x1080:r=24:d=300 -f lavfi -i sine=d=300 -c:v libx265 -preset ultrafast -c:a eac3 -ac 6 hevc8_eac3.mkv
# HEVC 10-bit
& $ff -f lavfi -i testsrc2=s=1920x1080:r=24:d=300 -f lavfi -i sine=d=300 -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -c:a aac hevc10.mkv
# H.264 + AC3 (copy mode)
& $ff -f lavfi -i testsrc2=s=1280x720:r=24:d=300 -f lavfi -i sine=d=300 -c:v libx264 -preset ultrafast -g 240 -c:a ac3 h264_ac3.mkv
# H.264 with AAC first track and AC3 second track (Phase 3)
& $ff -f lavfi -i testsrc2=s=1280x720:r=24:d=300 -f lavfi -i sine=f=440:d=300 -f lavfi -i sine=f=880:d=300 -map 0 -map 1 -map 2 -c:v libx264 -preset ultrafast -c:a:0 aac -c:a:1 ac3 h264_two_audio.mkv
# HDR10 HEVC
& $ff -f lavfi -i testsrc2=s=1920x1080:r=24:d=120 -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc" hdr10.mkv
# Interlaced MPEG-2 in a .ts (Phases 5 and 6)
& $ff -f lavfi -i testsrc2=s=720x576:r=25:d=120 -f lavfi -i sine=d=120 -vf "tinterlace=interleave_top,fieldorder=tff" -c:v mpeg2video -flags +ilme+ildct -top 1 -b:v 6M -c:a mp2 interlaced.ts
# XviD AVI (full re-encode, no HEVC involved)
& $ff -f lavfi -i testsrc2=s=720x400:r=24:d=120 -f lavfi -i sine=d=120 -c:v libxvid -q:v 4 -c:a libmp3lame xvid.avi
```

Also test with a few real files (an HEVC film, a DVD/TV rip, a file with several audio tracks) if you have them.

To check that the progress bar matches the picture, burn the timestamp into the test video. Add this filter to any command above (the font path is for Windows):

```powershell
-vf "drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='%{pts\:hms}':fontsize=96:fontcolor=white:box=1:boxcolor=black:x=40:y=40"
```

**Baseline checklist (existing features), Windows results from 2026-10-02:**

- [x] App starts; the main-process console shows `[stream] encoders: ...` with at least `libx264 (bundled ...)`. Shows `libx264 (bundled, tonemap: none)`. No system ffmpeg is on PATH.
- [x] `h264_ac3.mkv` plays (copy mode); seeking works; progress bar matches the picture. Starts in ~1.4s. After a seek, the burned-in time and the bar agree (3:32.6 vs 3:32). A seek starts at the keyframe at or before the target, so with `-g 240` (a keyframe every 10s) a seek to 0:30 starts at 0:20. That is expected for copied video.
- [x] `xvid.avi` plays through HLS; seek far ahead (~1s), seek back (near-instant). Starts in ~1.8s; seek ahead 0.7s; seek back 0.7s. Also tested `hevc8_eac3.mkv`: a seek ahead that restarts the encoder takes ~1.9s at 1080p with libx264.
- [x] While an HLS video plays, `%TEMP%\kino-hls\<pid>\` fills with `seg_*.m4s`; it is deleted when the player closes. Needed finding 1 below. Before that fix, nothing played.
- [x] No `ffmpeg.exe` is left in Task Manager after closing the player or quitting. The temp folder is also removed on quit; that needed finding 3 below.
- [x] Watch the console for ffmpeg errors containing `rename` (see "Windows risks" below). None seen.

### Phase 0 findings

Three bugs blocked or affected Windows playback. All are fixed on `main`.

1. **HLS init segment written to the wrong folder (Windows only).** ffmpeg's HLS muxer finds the folder for `-hls_fmp4_init_filename` by splitting the playlist path on `/` only. With a Windows path (`C:\...\run_1.m3u8`) it finds no folder and writes `init_N.mp4` to the process's working directory: the repo root in dev, wherever Kino was started from in a build. The session waited for a file that never appeared, so every re-encoded (HLS) video failed. Linux paths contain `/`, so Linux was never affected. **Fix** (`hls.ts` `startRun()`): spawn ffmpeg with `cwd: this.dir` and pass relative names for the segments and playlist. Keep this in mind for any new ffmpeg output path: ffmpeg treats `\` and `/` differently in some muxers.
2. **Player crashed on a saved volume above 1 (any platform).** An older build's ↑ key didn't clamp, and saved `kino_volume = 1.7999999999999994` to localStorage. Setting `video.volume` to that throws, which crashed `VideoPlayer` and left a blank screen. localStorage is per machine and per origin (dev `http://localhost:5173` vs built `file://`), so this only appeared where such a value had been saved. **Fix** (`VideoPlayer.tsx`): clamp the saved value to 0–1 when loading it.
3. **HLS temp folder left behind on quit (any platform).** `before-quit` stopped ffmpeg, but Electron exited before the asynchronous folder delete finished. **Fix** (`main.ts`, `streaming.ts` `shutdownStreams()`, `hls.ts` `removeHlsFiles()`): `before-quit` delays the quit until cleanup finishes, with a 3s cap, and removes the whole `kino-hls/<pid>` folder. It retries briefly while Windows still reports files as in use. Cleanup measured at ~150ms.

How to test without touching your own library: run a built app with an isolated profile and remote debugging, then drive it with the Chrome DevTools Protocol (renderer console, network requests, screenshots, mouse/keyboard input):

```powershell
npx vite build
$env:ELECTRON_ENABLE_LOGGING = 1   # main- and renderer-process console on stdout
node_modules\electron\dist\electron.exe . --user-data-dir="$env:TEMP\kino-test-profile" --remote-debugging-port=9222
```

In the renderer, `window.ipcRenderer.invoke('db:add-watch-path', '<test media folder>')` followed by `invoke('watcher:update')` adds the test files to the isolated library.

## Phase 1 — Windows encoder throttling (list item 4)

**Problem:** `hls.ts` pauses ffmpeg with `SIGSTOP`/`SIGCONT`, which don't exist on Windows (`CAN_PAUSE` is false there), so the whole movie is converted in the background at full speed.

**Change** (`electron/lib/hls.ts`, `collect()`): when the run is more than `MAX_ENCODE_AHEAD` segments past `lastRequested` and `CAN_PAUSE` is false, **stop the run** (`stopRun(run)`) instead of pausing it. Nothing else is needed: the next segment request past the cached block finds no running encoder, and `runFor()` starts a new run there. hls.js asks for that segment while it still has ~30s buffered, so the restart (~1s) is hidden. Keep `SIGSTOP` on Linux/macOS — resuming is cheaper than restarting.

**Test (Windows):**

- [ ] Play `xvid.avi` for 2+ minutes. `ffmpeg.exe` disappears from Task Manager about 60s ahead of playback and reappears as playback approaches the end of the cached segments, with no stall.
- [ ] Segment count in `%TEMP%\kino-hls` grows in steps, not all at once.

## Phase 2 — Decoder detection and fallback (list items 1 and 2)

These ship together: detection decides more files can play directly, and fallback catches the cases where that guess is wrong.

### 2a. Ask the player what it can decode

**Problem:** `media.ts` assumes no platform can decode HEVC (and 10-bit H.264, etc.). True on Linux, but Chromium on macOS, and on Windows with GPU HEVC decoding, can play HEVC directly — those users currently get unnecessary conversion.

**Change:**

1. Renderer, on startup (e.g. in `src/main.tsx` or `App.tsx`): build a support map with `MediaSource.isTypeSupported()` (falls back to `document.createElement('video').canPlayType()`), and send it to main with a new IPC call `media:set-decoder-support`. Suggested probes:

   | Key | MIME string |
   |---|---|
   | `hevc` | `video/mp4; codecs="hvc1.1.6.L120.90"` |
   | `hevc10` | `video/mp4; codecs="hvc1.2.4.L120.90"` |
   | `h264_10bit` | `video/mp4; codecs="avc1.6E0028"` |
   | `av1_10bit` | `video/mp4; codecs="av01.0.08M.10"` |
   | `vp9_10bit` | `video/mp4; codecs="vp09.02.40.10"` |
   | `ac3` / `eac3` | `audio/mp4; codecs="ac-3"` / `"ec-3"` |
   | `dts` | `audio/mp4; codecs="dtsc"` |

2. Main (`media.ts`): keep the current hard-coded sets as the **baseline** (always supported), and add codecs from the map. Choose HEVC support by `pix_fmt` (8-bit → `hevc`, 10-bit → `hevc10`). Until the map arrives, use the baseline only — that's today's behaviour, so Linux doesn't change.
3. The probe cache stores `PlaybackInfo`; split it so the raw ffprobe data is cached and `info` is computed per call from the current support map.

### 2b. Fall back to conversion when direct playback fails

**Problem:** if a file is played directly and Chromium can't decode it, the user gets "This video format isn't supported". Detection (2a) makes this more likely: a codec can be "supported" in MP4 but not in a given MKV, or not at a given profile/level.

**Change:**

1. `VideoPlayer.tsx` `<video onError>`: if the current mode is direct and `error.code` is `MEDIA_ERR_DECODE` (3) or `MEDIA_ERR_SRC_NOT_SUPPORTED` (4), don't show the error. Remember the position and call a new IPC `media:force-conversion(filePath)`.
2. Main: keep a per-session `Set` of files that failed direct playback. `getMediaDetails` treats them as `transcode`:
   - first failure → `copyVideo: true` if the video codec is in the support set (only the container/audio may be the problem),
   - second failure (the copy-mode stream also errored) → `copyVideo: false`, i.e. full re-encode via HLS.
3. The player re-runs its mode selection at the remembered position (reuse the `init` logic; factor the mode choice out of the effect).
4. Guard against loops: at most one fallback step per error, and stop after HLS. A missing file (ffprobe fails) should still show the error.

**Test (Linux first, then Windows/macOS):**

- [ ] Linux: map comes back with HEVC unsupported → behaviour identical to today.
- [ ] Linux, simulated: temporarily force `hevc: true` in the map → `hevc8_eac3.mkv` tries direct, fails, falls back to conversion within ~2s at the same position, no error screen. Remove the override.
- [ ] Windows: log the support map (add a temporary `console.log`). Record whether `hevc`/`hevc10` are true on this machine.
- [ ] Windows with HEVC support: `hevc8_eac3.mkv` plays with **copy mode** (video copied, only E-AC3 converted) — the "Converted" badge shows, and Task Manager shows low ffmpeg CPU. `hevc10.mkv` plays directly if `hevc10` is true.
- [ ] Windows without HEVC support (or a VM): HEVC files go through HLS exactly as on Linux.

## Phase 3 — Audio track checks (list item 5)

**Problem:** only the first audio track is checked. `h264_two_audio.mkv` plays directly; switching to the AC3 track uses the element's `audioTracks` API and fails silently (no sound).

**Change:**

1. `VideoPlayer.tsx` `toggleAudioTrack`, direct branch: look up the selected track's codec (the tracks come from `media:get-metadata`, which already includes `codec`; keep it on the track objects). If the codec isn't in the support map (Phase 2), switch to conversion with that track instead: copy mode via `startStreamAt(currentTime, playing)` with `audioStreamIndexRef` set, after marking the player as progressive.
2. `media.ts` `resolveStreamStart()` currently returns early unless `info.mode === 'transcode'`. Change the condition to "video is being copied" so keyframe snapping also works for a direct file switched to copy mode.
3. Switching back to a supported track can stay in copy mode (simplest) or return to direct; staying is fine.

**Test:**

- [ ] `h264_two_audio.mkv`: switch to track 2 → the tone changes pitch (880 Hz), position kept, "Converted" badge appears.
- [ ] Switch back to track 1 → still plays.
- [ ] Progress bar and subtitles stay in sync after the switch.

## Phase 4 — More GPU encoders (list item 3)

**Problem:** GPU encoding only works through VAAPI on Linux. NVIDIA, Windows and macOS encoders aren't used.

**Change** (`electron/lib/encoders.ts`, `electron/lib/media.ts` `buildVideoArgs()`):

1. Add candidates, each tested at startup like the VAAPI ones (only on the platforms where they exist):

   | Encoder | Platforms | Input frames | Base args (to verify) | HLS keyframes |
   |---|---|---|---|---|
   | `h264_nvenc` | Windows, Linux | `format=yuv420p` (software decode) | `-preset p4 -rc vbr -cq 23 -b:v 0` | `-forced-idr 1` |
   | `h264_qsv` | Windows | `format=nv12` | `-preset veryfast -global_quality 23` | `-forced_idr 1` |
   | `h264_amf` | Windows | `format=nv12` | `-quality speed -rc cqp -qp_i 22 -qp_p 22` | check `-h encoder=h264_amf` for an IDR option |
   | `h264_videotoolbox` | macOS | `format=nv12` | `-q:v 60` (Apple Silicon) or `-b:v 8M` | `-force_key_frames` alone should give IDR |

   Ranking: hardware H.264 encoders first, then `vp9_vaapi`, then `libx264`. Encoder options above are from the ffmpeg docs and haven't been run — confirm each with `ffmpeg -h encoder=<name>` on a machine that has it.
2. **Check keyframe placement in the startup test.** HLS breaks if an encoder ignores forced keyframes (segments come out the wrong length). Extend the test for each encoder: encode 4s of `testsrc2` to HLS with `-hls_time 1` and the same `-force_key_frames expr:gte(t,n_forced*1)` arguments, then check that 4 segments were written. Only encoders that pass are used for HLS; ones that fail it may still be used for the progressive stream.
3. Keep using software decoding for these at first (simplest, works everywhere). Hardware decoding (`-hwaccel cuda` / `d3d11va` / `qsv` / `videotoolbox`) can come later, after measuring.

**Test (Windows):**

- [ ] Console `[stream] encoders:` lists the encoders for the GPU in this machine (e.g. `h264_nvenc > libx264`).
- [ ] `hevc10.mkv` (forced to convert if needed) plays through HLS; Task Manager → Performance → GPU shows "Video Encode" activity; ffmpeg CPU is well below the libx264 case.
- [ ] Seek far ahead and back: segments line up (no jumps or stalls at segment boundaries).
- [ ] Temporarily break the top encoder (e.g. wrong option) → the stream still plays via the next profile; console shows `failed, trying next`.

## Phase 5 — Deinterlacing (list item 6)

**Problem:** interlaced sources (DVD, broadcast TV) are converted without deinterlacing, so motion shows comb lines. Chromium doesn't deinterlace either, so interlaced H.264 played directly also combs.

**Change:**

1. `media.ts` `getMediaDetails()`: record `interlaced` when the video stream's `field_order` is `tt`, `bb`, `tb` or `bt`.
2. `buildVideoArgs()`: when interlaced, put `bwdif=mode=send_frame:parity=auto:deint=interlaced` first in the filter chain (`deint=interlaced` leaves progressive frames in mixed sources untouched).
3. Decision to make: should interlaced video whose codec *is* supported (interlaced H.264) be re-encoded so it gets deinterlaced, instead of played directly with combing? Recommended: yes, re-encode — cost is small for SD material.

**Test:**

- [ ] `interlaced.ts` (after Phase 6 adds `.ts`): moving test pattern has no comb lines.
- [ ] Progressive files are unaffected (compare a frame before/after).

## Phase 6 — More file types (list item 7)

**Change:**

1. [`electron/lib/watcher.ts`](../electron/lib/watcher.ts) `VIDEO_EXTENSIONS`: add `.webm .m4v .ts .m2ts .mts .mpg .mpeg .flv`.
2. `electron/main.ts` `getMimeType()` (inside the `media` protocol handler): add `.m4v` → `video/mp4` (`.webm` is already there). The other new types never play directly (`DIRECT_CONTAINERS` in `media.ts` excludes them), so they go through conversion.
3. Existing libraries pick the new files up on the next scan.

**Test:**

- [ ] Files with each new extension appear in the library and play.

## Phase 7 — Release builds (list item 8)

**Problem:** `ffmpeg-static` downloads the ffmpeg binary for the OS that runs `npm install`. An installer built on Linux for Windows or macOS would ship the Linux ffmpeg, and conversion wouldn't work at all for those users. (`ffprobe-static` is fine: it ships all three platforms' binaries.)

**Change (recommended):** build each platform on its own OS with a CI matrix (e.g. GitHub Actions `runs-on: [ubuntu-latest, windows-latest, macos-latest]`, steps: checkout → `npx -y yarn@1 install` → `npx -y yarn@1 build` → upload `release/`). macOS needs separate x64 and arm64 builds, or a universal build with both ffmpeg binaries.

**Alternative:** cross-build with `npm_config_platform=win32 npm_config_arch=x64` set during install, which `ffmpeg-static`'s install script honours. That's more fragile (native modules like `better-sqlite3` also need the right platform).

**Test:**

- [ ] Install the Windows installer on a clean machine (or VM) without dev tools; a converted video plays.

## Later

- **Dolby Vision profile 5** (no HDR10 base layer, common in streaming rips): colours come out wrong (purple/green) when tone-mapped. libplacebo can handle DV metadata; zscale can't.
- **Hardware decoding** for the new encoders (see Phase 4, step 3).
- **Remember failed direct playback across restarts** (Phase 2b keeps it per session); could be stored in the database.

## Windows risks to watch while testing

These were guesses from reading the code. The outcome of each, from the Phase 0 run (2026-10-02), is in bold. The bug that actually broke playback, the init-segment path ([Phase 0 findings](#phase-0-findings) item 1), wasn't on this list.

- **Renaming segments over existing files.** HLS uses `-hls_flags temp_file`: ffmpeg writes `seg_N.m4s.tmp` and renames it. On Windows a rename fails if the target exists. That only happens when a run reaches segments that are already cached; `collect()` stops such runs within ~100ms, but ffmpeg may have tried the rename first. Expected effect: an error line in the console and the run exiting early, which is harmless. If it causes stalls, stop runs one segment earlier. **Not seen:** no `rename` errors, including runs that seeked back into cached segments. Watch for it again once Phase 1 makes restarts frequent.
- **Deleting a session folder while ffmpeg still holds a file.** `HlsSession.destroy()` waits for the process to exit before removing the folder; check `%TEMP%\kino-hls` is actually emptied. **Fine when the player closes** (ffmpeg exits in ~190ms, then the folder is removed). **On quit, the folder was left behind** because the app exited first (Phase 0 findings, item 3); that is now fixed.
- **Antivirus scanning** new segment files can slow the first segment after a seek; worth noting if seeks are slow on Windows only. **Not seen:** the first segment arrives in under 1s with the test machine's default antivirus setup.
- **System ffmpeg on PATH.** If one is installed (e.g. via winget/choco), it is tested alongside the bundled one and may be preferred if it has better encoders. Check the `[stream] encoders:` line says which binary is used. **Not present** on the test machine, so only the bundled build was used. Untested with a system ffmpeg.

import { app as G, BrowserWindow as ie, ipcMain as k, dialog as se, protocol as Qe } from "electron";
import { fileURLToPath as Zn } from "node:url";
import V, { resolve as Pe, join as tr, relative as er, sep as nr } from "node:path";
import Dt from "node:fs";
import rr from "better-sqlite3";
import * as p from "path";
import F from "path";
import Ze, { unwatchFile as Re, watchFile as ir, watch as sr, stat as or } from "fs";
import { realpath as Ht, stat as oe, lstat as ar, open as cr, readdir as lr } from "fs/promises";
import { EventEmitter as ur } from "events";
import { lstat as be, stat as fr, readdir as dr, realpath as hr } from "node:fs/promises";
import { Readable as mr } from "node:stream";
import { type as pr } from "os";
import yr from "constants";
import wr from "stream";
import Er from "util";
import _r from "assert";
import At from "fluent-ffmpeg";
import Te from "ffmpeg-static";
import zt from "ffprobe-static";
let Pt = null, Fe = null;
function v() {
  return Pt || (Fe = F.join(G.getPath("userData"), "kino.db"), Pt = new rr(Fe), Pt.pragma("foreign_keys = ON")), Pt;
}
function gr() {
  v().exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      plot TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      rating REAL,
      file_path TEXT UNIQUE NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS watch_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlist_movies (
      playlist_id INTEGER,
      movie_id INTEGER,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (playlist_id, movie_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playback_progress (
      movie_id INTEGER PRIMARY KEY,
      progress REAL NOT NULL,
      last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deleted_folder_playlists (
      folder_name TEXT PRIMARY KEY,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
function $t() {
  return v().prepare("SELECT * FROM movies ORDER BY added_at DESC").all();
}
function tn(e) {
  return !!v().prepare("SELECT 1 FROM movies WHERE file_path = ?").get(e);
}
function en(e) {
  return v().prepare(`
    INSERT OR IGNORE INTO movies (title, original_title, year, plot, poster_path, backdrop_path, rating, file_path)
    VALUES (@title, @original_title, @year, @plot, @poster_path, @backdrop_path, @rating, @file_path)
  `).run(e);
}
function ae() {
  return v().prepare("SELECT * FROM watch_paths").all();
}
function Sr(e) {
  return v().prepare("INSERT OR IGNORE INTO watch_paths (path) VALUES (?)").run(e);
}
function vr(e) {
  return v().prepare("DELETE FROM watch_paths WHERE id = ?").run(e);
}
function Pr(e) {
  const t = v().prepare("SELECT value FROM settings WHERE key = ?").get(e);
  return t ? t.value : null;
}
function Rr(e, t) {
  return v().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(e, t);
}
function ce(e, t) {
  return v().prepare(`
    UPDATE movies
    SET title = @title,
        original_title = @original_title,
        year = @year,
        plot = @plot,
        poster_path = @poster_path,
        backdrop_path = @backdrop_path,
        rating = @rating
    WHERE id = @id
  `).run({ ...t, id: e });
}
function br(e) {
  console.log("Database: Attempting to remove movie with path:", e);
  const t = v().prepare("DELETE FROM movies WHERE file_path = ?").run(e);
  return console.log("Database: Removal result:", t), t;
}
function Tr(e) {
  const t = e.endsWith(F.sep) ? e : e + F.sep;
  console.log("Database: Removing movies from watch path:", t);
  const n = v().prepare(`
    DELETE FROM movies 
    WHERE file_path LIKE ? ESCAPE '\\'
       OR file_path = ?
  `).run(`${t.replace(/[%_]/g, "\\$&")}%`, e);
  return console.log("Database: Removed", n.changes, "movies from watch path"), n;
}
function Fr(e) {
  return v().prepare("SELECT * FROM watch_paths WHERE id = ?").get(e);
}
function nn(e) {
  return v().prepare("INSERT INTO playlists (name) VALUES (?)").run(e);
}
function qt() {
  return v().prepare("SELECT * FROM playlists ORDER BY created_at DESC").all();
}
function Dr(e) {
  return v().prepare("SELECT * FROM playlists WHERE id = ?").get(e);
}
function kr(e) {
  return v().prepare("DELETE FROM playlists WHERE id = ?").run(e);
}
function Ir(e) {
  return v().prepare("INSERT OR REPLACE INTO deleted_folder_playlists (folder_name) VALUES (?)").run(e);
}
function Or(e) {
  return v().prepare("DELETE FROM deleted_folder_playlists WHERE folder_name = ?").run(e);
}
function Nr() {
  return v().prepare("SELECT folder_name FROM deleted_folder_playlists").all().map((t) => t.folder_name);
}
function rn() {
  const e = v().prepare(`
    DELETE FROM playlists 
    WHERE id NOT IN (SELECT DISTINCT playlist_id FROM playlist_movies)
  `).run();
  return e.changes > 0 && console.log(`Database: Deleted ${e.changes} empty playlists`), e;
}
function sn(e, t) {
  return v().prepare("INSERT OR IGNORE INTO playlist_movies (playlist_id, movie_id) VALUES (?, ?)").run(e, t);
}
function $r(e, t) {
  return v().prepare("DELETE FROM playlist_movies WHERE playlist_id = ? AND movie_id = ?").run(e, t);
}
function Cr(e) {
  return v().prepare(`
    SELECT m.*, pm.added_at as playlist_added_at
    FROM movies m
    JOIN playlist_movies pm ON m.id = pm.movie_id
    WHERE pm.playlist_id = ?
    ORDER BY pm.added_at DESC
  `).all(e);
}
function Lr(e, t) {
  return v().prepare(`
    INSERT OR REPLACE INTO playback_progress (movie_id, progress, last_watched)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(e, t);
}
function Ar(e) {
  const t = v().prepare("SELECT progress FROM playback_progress WHERE movie_id = ?").get(e);
  return t ? t.progress : 0;
}
const B = {
  FILE_TYPE: "files",
  DIR_TYPE: "directories",
  FILE_DIR_TYPE: "files_directories",
  EVERYTHING_TYPE: "all"
}, Qt = {
  root: ".",
  fileFilter: (e) => !0,
  directoryFilter: (e) => !0,
  type: B.FILE_TYPE,
  lstat: !1,
  depth: 2147483648,
  alwaysStat: !1,
  highWaterMark: 4096
};
Object.freeze(Qt);
const on = "READDIRP_RECURSIVE_ERROR", xr = /* @__PURE__ */ new Set(["ENOENT", "EPERM", "EACCES", "ELOOP", on]), De = [
  B.DIR_TYPE,
  B.EVERYTHING_TYPE,
  B.FILE_DIR_TYPE,
  B.FILE_TYPE
], Mr = /* @__PURE__ */ new Set([
  B.DIR_TYPE,
  B.EVERYTHING_TYPE,
  B.FILE_DIR_TYPE
]), Wr = /* @__PURE__ */ new Set([
  B.EVERYTHING_TYPE,
  B.FILE_DIR_TYPE,
  B.FILE_TYPE
]), jr = (e) => xr.has(e.code), Ur = process.platform === "win32", ke = (e) => !0, Ie = (e) => {
  if (e === void 0)
    return ke;
  if (typeof e == "function")
    return e;
  if (typeof e == "string") {
    const t = e.trim();
    return (n) => n.basename === t;
  }
  if (Array.isArray(e)) {
    const t = e.map((n) => n.trim());
    return (n) => t.some((i) => n.basename === i);
  }
  return ke;
};
class Yr extends mr {
  constructor(t = {}) {
    super({
      objectMode: !0,
      autoDestroy: !0,
      highWaterMark: t.highWaterMark
    });
    const n = { ...Qt, ...t }, { root: i, type: r } = n;
    this._fileFilter = Ie(n.fileFilter), this._directoryFilter = Ie(n.directoryFilter);
    const s = n.lstat ? be : fr;
    Ur ? this._stat = (o) => s(o, { bigint: !0 }) : this._stat = s, this._maxDepth = n.depth ?? Qt.depth, this._wantsDir = r ? Mr.has(r) : !1, this._wantsFile = r ? Wr.has(r) : !1, this._wantsEverything = r === B.EVERYTHING_TYPE, this._root = Pe(i), this._isDirent = !n.alwaysStat, this._statsProp = this._isDirent ? "dirent" : "stats", this._rdOptions = { encoding: "utf8", withFileTypes: this._isDirent }, this.parents = [this._exploreDir(i, 1)], this.reading = !1, this.parent = void 0;
  }
  async _read(t) {
    if (!this.reading) {
      this.reading = !0;
      try {
        for (; !this.destroyed && t > 0; ) {
          const n = this.parent, i = n && n.files;
          if (i && i.length > 0) {
            const { path: r, depth: s } = n, o = i.splice(0, t).map((l) => this._formatEntry(l, r)), a = await Promise.all(o);
            for (const l of a) {
              if (!l)
                continue;
              if (this.destroyed)
                return;
              const f = await this._getEntryType(l);
              f === "directory" && this._directoryFilter(l) ? (s <= this._maxDepth && this.parents.push(this._exploreDir(l.fullPath, s + 1)), this._wantsDir && (this.push(l), t--)) : (f === "file" || this._includeAsFile(l)) && this._fileFilter(l) && this._wantsFile && (this.push(l), t--);
            }
          } else {
            const r = this.parents.pop();
            if (!r) {
              this.push(null);
              break;
            }
            if (this.parent = await r, this.destroyed)
              return;
          }
        }
      } catch (n) {
        this.destroy(n);
      } finally {
        this.reading = !1;
      }
    }
  }
  async _exploreDir(t, n) {
    let i;
    try {
      i = await dr(t, this._rdOptions);
    } catch (r) {
      this._onError(r);
    }
    return { files: i, depth: n, path: t };
  }
  async _formatEntry(t, n) {
    let i;
    const r = this._isDirent ? t.name : t;
    try {
      const s = Pe(tr(n, r));
      i = { path: er(this._root, s), fullPath: s, basename: r }, i[this._statsProp] = this._isDirent ? t : await this._stat(s);
    } catch (s) {
      this._onError(s);
      return;
    }
    return i;
  }
  _onError(t) {
    jr(t) && !this.destroyed ? this.emit("warn", t) : this.destroy(t);
  }
  async _getEntryType(t) {
    if (!t && this._statsProp in t)
      return "";
    const n = t[this._statsProp];
    if (n.isFile())
      return "file";
    if (n.isDirectory())
      return "directory";
    if (n && n.isSymbolicLink()) {
      const i = t.fullPath;
      try {
        const r = await hr(i), s = await be(r);
        if (s.isFile())
          return "file";
        if (s.isDirectory()) {
          const o = r.length;
          if (i.startsWith(r) && i.substr(o, 1) === nr) {
            const a = new Error(`Circular symlink detected: "${i}" points to "${r}"`);
            return a.code = on, this._onError(a);
          }
          return "directory";
        }
      } catch (r) {
        return this._onError(r), "";
      }
    }
  }
  _includeAsFile(t) {
    const n = t && t[this._statsProp];
    return n && this._wantsEverything && !n.isDirectory();
  }
}
function Hr(e, t = {}) {
  let n = t.entryType || t.type;
  if (n === "both" && (n = B.FILE_DIR_TYPE), n && (t.type = n), e) {
    if (typeof e != "string")
      throw new TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
    if (n && !De.includes(n))
      throw new Error(`readdirp: Invalid type passed. Use one of ${De.join(", ")}`);
  } else throw new Error("readdirp: root argument is required. Usage: readdirp(root, options)");
  return t.root = e, new Yr(t);
}
const zr = "data", an = "end", Br = "close", le = () => {
}, xt = process.platform, cn = xt === "win32", Gr = xt === "darwin", Kr = xt === "linux", Vr = xt === "freebsd", Jr = pr() === "OS400", I = {
  ALL: "all",
  READY: "ready",
  ADD: "add",
  CHANGE: "change",
  ADD_DIR: "addDir",
  UNLINK: "unlink",
  UNLINK_DIR: "unlinkDir",
  RAW: "raw",
  ERROR: "error"
}, K = I, Xr = "watch", qr = { lstat: ar, stat: oe }, it = "listeners", kt = "errHandlers", ct = "rawEmitters", Qr = [it, kt, ct], Zr = /* @__PURE__ */ new Set([
  "3dm",
  "3ds",
  "3g2",
  "3gp",
  "7z",
  "a",
  "aac",
  "adp",
  "afdesign",
  "afphoto",
  "afpub",
  "ai",
  "aif",
  "aiff",
  "alz",
  "ape",
  "apk",
  "appimage",
  "ar",
  "arj",
  "asf",
  "au",
  "avi",
  "bak",
  "baml",
  "bh",
  "bin",
  "bk",
  "bmp",
  "btif",
  "bz2",
  "bzip2",
  "cab",
  "caf",
  "cgm",
  "class",
  "cmx",
  "cpio",
  "cr2",
  "cur",
  "dat",
  "dcm",
  "deb",
  "dex",
  "djvu",
  "dll",
  "dmg",
  "dng",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dra",
  "DS_Store",
  "dsk",
  "dts",
  "dtshd",
  "dvb",
  "dwg",
  "dxf",
  "ecelp4800",
  "ecelp7470",
  "ecelp9600",
  "egg",
  "eol",
  "eot",
  "epub",
  "exe",
  "f4v",
  "fbs",
  "fh",
  "fla",
  "flac",
  "flatpak",
  "fli",
  "flv",
  "fpx",
  "fst",
  "fvt",
  "g3",
  "gh",
  "gif",
  "graffle",
  "gz",
  "gzip",
  "h261",
  "h263",
  "h264",
  "icns",
  "ico",
  "ief",
  "img",
  "ipa",
  "iso",
  "jar",
  "jpeg",
  "jpg",
  "jpgv",
  "jpm",
  "jxr",
  "key",
  "ktx",
  "lha",
  "lib",
  "lvp",
  "lz",
  "lzh",
  "lzma",
  "lzo",
  "m3u",
  "m4a",
  "m4v",
  "mar",
  "mdi",
  "mht",
  "mid",
  "midi",
  "mj2",
  "mka",
  "mkv",
  "mmr",
  "mng",
  "mobi",
  "mov",
  "movie",
  "mp3",
  "mp4",
  "mp4a",
  "mpeg",
  "mpg",
  "mpga",
  "mxu",
  "nef",
  "npx",
  "numbers",
  "nupkg",
  "o",
  "odp",
  "ods",
  "odt",
  "oga",
  "ogg",
  "ogv",
  "otf",
  "ott",
  "pages",
  "pbm",
  "pcx",
  "pdb",
  "pdf",
  "pea",
  "pgm",
  "pic",
  "png",
  "pnm",
  "pot",
  "potm",
  "potx",
  "ppa",
  "ppam",
  "ppm",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "psd",
  "pya",
  "pyc",
  "pyo",
  "pyv",
  "qt",
  "rar",
  "ras",
  "raw",
  "resources",
  "rgb",
  "rip",
  "rlc",
  "rmf",
  "rmvb",
  "rpm",
  "rtf",
  "rz",
  "s3m",
  "s7z",
  "scpt",
  "sgi",
  "shar",
  "snap",
  "sil",
  "sketch",
  "slk",
  "smv",
  "snk",
  "so",
  "stl",
  "suo",
  "sub",
  "swf",
  "tar",
  "tbz",
  "tbz2",
  "tga",
  "tgz",
  "thmx",
  "tif",
  "tiff",
  "tlz",
  "ttc",
  "ttf",
  "txz",
  "udf",
  "uvh",
  "uvi",
  "uvm",
  "uvp",
  "uvs",
  "uvu",
  "viv",
  "vob",
  "war",
  "wav",
  "wax",
  "wbmp",
  "wdp",
  "weba",
  "webm",
  "webp",
  "whl",
  "wim",
  "wm",
  "wma",
  "wmv",
  "wmx",
  "woff",
  "woff2",
  "wrm",
  "wvx",
  "xbm",
  "xif",
  "xla",
  "xlam",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
  "xm",
  "xmind",
  "xpi",
  "xpm",
  "xwd",
  "xz",
  "z",
  "zip",
  "zipx"
]), ti = (e) => Zr.has(p.extname(e).slice(1).toLowerCase()), Zt = (e, t) => {
  e instanceof Set ? e.forEach(t) : t(e);
}, pt = (e, t, n) => {
  let i = e[t];
  i instanceof Set || (e[t] = i = /* @__PURE__ */ new Set([i])), i.add(n);
}, ei = (e) => (t) => {
  const n = e[t];
  n instanceof Set ? n.clear() : delete e[t];
}, yt = (e, t, n) => {
  const i = e[t];
  i instanceof Set ? i.delete(n) : i === n && delete e[t];
}, ln = (e) => e instanceof Set ? e.size === 0 : !e, It = /* @__PURE__ */ new Map();
function Oe(e, t, n, i, r) {
  const s = (o, a) => {
    n(e), r(o, a, { watchedPath: e }), a && e !== a && Ot(p.resolve(e, a), it, p.join(e, a));
  };
  try {
    return sr(e, {
      persistent: t.persistent
    }, s);
  } catch (o) {
    i(o);
    return;
  }
}
const Ot = (e, t, n, i, r) => {
  const s = It.get(e);
  s && Zt(s[t], (o) => {
    o(n, i, r);
  });
}, ni = (e, t, n, i) => {
  const { listener: r, errHandler: s, rawEmitter: o } = i;
  let a = It.get(t), l;
  if (!n.persistent)
    return l = Oe(e, n, r, s, o), l ? l.close.bind(l) : void 0;
  if (a)
    pt(a, it, r), pt(a, kt, s), pt(a, ct, o);
  else {
    if (l = Oe(
      e,
      n,
      Ot.bind(null, t, it),
      s,
      // no need to use broadcast here
      Ot.bind(null, t, ct)
    ), !l)
      return;
    l.on(K.ERROR, async (f) => {
      const c = Ot.bind(null, t, kt);
      if (a && (a.watcherUnusable = !0), cn && f.code === "EPERM")
        try {
          await (await cr(e, "r")).close(), c(f);
        } catch {
        }
      else
        c(f);
    }), a = {
      listeners: r,
      errHandlers: s,
      rawEmitters: o,
      watcher: l
    }, It.set(t, a);
  }
  return () => {
    yt(a, it, r), yt(a, kt, s), yt(a, ct, o), ln(a.listeners) && (a.watcher.close(), It.delete(t), Qr.forEach(ei(a)), a.watcher = void 0, Object.freeze(a));
  };
}, Bt = /* @__PURE__ */ new Map(), ri = (e, t, n, i) => {
  const { listener: r, rawEmitter: s } = i;
  let o = Bt.get(t);
  const a = o && o.options;
  return a && (a.persistent < n.persistent || a.interval > n.interval) && (Re(t), o = void 0), o ? (pt(o, it, r), pt(o, ct, s)) : (o = {
    listeners: r,
    rawEmitters: s,
    options: n,
    watcher: ir(t, n, (l, f) => {
      Zt(o.rawEmitters, (u) => {
        u(K.CHANGE, t, { curr: l, prev: f });
      });
      const c = l.mtimeMs;
      (l.size !== f.size || c > f.mtimeMs || c === 0) && Zt(o.listeners, (u) => u(e, l));
    })
  }, Bt.set(t, o)), () => {
    yt(o, it, r), yt(o, ct, s), ln(o.listeners) && (Bt.delete(t), Re(t), o.options = o.watcher = void 0, Object.freeze(o));
  };
};
class ii {
  constructor(t) {
    this.fsw = t, this._boundHandleError = (n) => t._handleError(n);
  }
  /**
   * Watch file for changes with fs_watchFile or fs_watch.
   * @param path to file or dir
   * @param listener on fs change
   * @returns closer for the watcher instance
   */
  _watchWithNodeFs(t, n) {
    const i = this.fsw.options, r = p.dirname(t), s = p.basename(t);
    this.fsw._getWatchedDir(r).add(s);
    const a = p.resolve(t), l = {
      persistent: i.persistent
    };
    n || (n = le);
    let f;
    if (i.usePolling) {
      const c = i.interval !== i.binaryInterval;
      l.interval = c && ti(s) ? i.binaryInterval : i.interval, f = ri(t, a, l, {
        listener: n,
        rawEmitter: this.fsw._emitRaw
      });
    } else
      f = ni(t, a, l, {
        listener: n,
        errHandler: this._boundHandleError,
        rawEmitter: this.fsw._emitRaw
      });
    return f;
  }
  /**
   * Watch a file and emit add event if warranted.
   * @returns closer for the watcher instance
   */
  _handleFile(t, n, i) {
    if (this.fsw.closed)
      return;
    const r = p.dirname(t), s = p.basename(t), o = this.fsw._getWatchedDir(r);
    let a = n;
    if (o.has(s))
      return;
    const l = async (c, u) => {
      if (this.fsw._throttle(Xr, t, 5)) {
        if (!u || u.mtimeMs === 0)
          try {
            const d = await oe(t);
            if (this.fsw.closed)
              return;
            const h = d.atimeMs, m = d.mtimeMs;
            if ((!h || h <= m || m !== a.mtimeMs) && this.fsw._emit(K.CHANGE, t, d), (Gr || Kr || Vr) && a.ino !== d.ino) {
              this.fsw._closeFile(c), a = d;
              const w = this._watchWithNodeFs(t, l);
              w && this.fsw._addPathCloser(c, w);
            } else
              a = d;
          } catch {
            this.fsw._remove(r, s);
          }
        else if (o.has(s)) {
          const d = u.atimeMs, h = u.mtimeMs;
          (!d || d <= h || h !== a.mtimeMs) && this.fsw._emit(K.CHANGE, t, u), a = u;
        }
      }
    }, f = this._watchWithNodeFs(t, l);
    if (!(i && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(t)) {
      if (!this.fsw._throttle(K.ADD, t, 0))
        return;
      this.fsw._emit(K.ADD, t, n);
    }
    return f;
  }
  /**
   * Handle symlinks encountered while reading a dir.
   * @param entry returned by readdirp
   * @param directory path of dir being read
   * @param path of this item
   * @param item basename of this item
   * @returns true if no more processing is needed for this entry.
   */
  async _handleSymlink(t, n, i, r) {
    if (this.fsw.closed)
      return;
    const s = t.fullPath, o = this.fsw._getWatchedDir(n);
    if (!this.fsw.options.followSymlinks) {
      this.fsw._incrReadyCount();
      let a;
      try {
        a = await Ht(i);
      } catch {
        return this.fsw._emitReady(), !0;
      }
      return this.fsw.closed ? void 0 : (o.has(r) ? this.fsw._symlinkPaths.get(s) !== a && (this.fsw._symlinkPaths.set(s, a), this.fsw._emit(K.CHANGE, i, t.stats)) : (o.add(r), this.fsw._symlinkPaths.set(s, a), this.fsw._emit(K.ADD, i, t.stats)), this.fsw._emitReady(), !0);
    }
    if (this.fsw._symlinkPaths.has(s))
      return !0;
    this.fsw._symlinkPaths.set(s, !0);
  }
  _handleRead(t, n, i, r, s, o, a) {
    if (t = p.join(t, ""), a = this.fsw._throttle("readdir", t, 1e3), !a)
      return;
    const l = this.fsw._getWatchedDir(i.path), f = /* @__PURE__ */ new Set();
    let c = this.fsw._readdirp(t, {
      fileFilter: (u) => i.filterPath(u),
      directoryFilter: (u) => i.filterDir(u)
    });
    if (c)
      return c.on(zr, async (u) => {
        if (this.fsw.closed) {
          c = void 0;
          return;
        }
        const d = u.path;
        let h = p.join(t, d);
        if (f.add(d), !(u.stats.isSymbolicLink() && await this._handleSymlink(u, t, h, d))) {
          if (this.fsw.closed) {
            c = void 0;
            return;
          }
          (d === r || !r && !l.has(d)) && (this.fsw._incrReadyCount(), h = p.join(s, p.relative(s, h)), this._addToNodeFs(h, n, i, o + 1));
        }
      }).on(K.ERROR, this._boundHandleError), new Promise((u, d) => {
        if (!c)
          return d();
        c.once(an, () => {
          if (this.fsw.closed) {
            c = void 0;
            return;
          }
          const h = a ? a.clear() : !1;
          u(void 0), l.getChildren().filter((m) => m !== t && !f.has(m)).forEach((m) => {
            this.fsw._remove(t, m);
          }), c = void 0, h && this._handleRead(t, !1, i, r, s, o, a);
        });
      });
  }
  /**
   * Read directory to add / remove files from `@watched` list and re-read it on change.
   * @param dir fs path
   * @param stats
   * @param initialAdd
   * @param depth relative to user-supplied path
   * @param target child path targeted for watch
   * @param wh Common watch helpers for this path
   * @param realpath
   * @returns closer for the watcher instance.
   */
  async _handleDir(t, n, i, r, s, o, a) {
    const l = this.fsw._getWatchedDir(p.dirname(t)), f = l.has(p.basename(t));
    !(i && this.fsw.options.ignoreInitial) && !s && !f && this.fsw._emit(K.ADD_DIR, t, n), l.add(p.basename(t)), this.fsw._getWatchedDir(t);
    let c, u;
    const d = this.fsw.options.depth;
    if ((d == null || r <= d) && !this.fsw._symlinkPaths.has(a)) {
      if (!s && (await this._handleRead(t, i, o, s, t, r, c), this.fsw.closed))
        return;
      u = this._watchWithNodeFs(t, (h, m) => {
        m && m.mtimeMs === 0 || this._handleRead(h, !1, o, s, t, r, c);
      });
    }
    return u;
  }
  /**
   * Handle added file, directory, or glob pattern.
   * Delegates call to _handleFile / _handleDir after checks.
   * @param path to file or ir
   * @param initialAdd was the file added at watch instantiation?
   * @param priorWh depth relative to user-supplied path
   * @param depth Child path actually targeted for watch
   * @param target Child path actually targeted for watch
   */
  async _addToNodeFs(t, n, i, r, s) {
    const o = this.fsw._emitReady;
    if (this.fsw._isIgnored(t) || this.fsw.closed)
      return o(), !1;
    const a = this.fsw._getWatchHelpers(t);
    i && (a.filterPath = (l) => i.filterPath(l), a.filterDir = (l) => i.filterDir(l));
    try {
      const l = await qr[a.statMethod](a.watchPath);
      if (this.fsw.closed)
        return;
      if (this.fsw._isIgnored(a.watchPath, l))
        return o(), !1;
      const f = this.fsw.options.followSymlinks;
      let c;
      if (l.isDirectory()) {
        const u = p.resolve(t), d = f ? await Ht(t) : t;
        if (this.fsw.closed || (c = await this._handleDir(a.watchPath, l, n, r, s, a, d), this.fsw.closed))
          return;
        u !== d && d !== void 0 && this.fsw._symlinkPaths.set(u, d);
      } else if (l.isSymbolicLink()) {
        const u = f ? await Ht(t) : t;
        if (this.fsw.closed)
          return;
        const d = p.dirname(a.watchPath);
        if (this.fsw._getWatchedDir(d).add(a.watchPath), this.fsw._emit(K.ADD, a.watchPath, l), c = await this._handleDir(d, l, n, r, t, a, u), this.fsw.closed)
          return;
        u !== void 0 && this.fsw._symlinkPaths.set(p.resolve(t), u);
      } else
        c = this._handleFile(a.watchPath, l, n);
      return o(), c && this.fsw._addPathCloser(t, c), !1;
    } catch (l) {
      if (this.fsw._handleError(l))
        return o(), t;
    }
  }
}
/*! chokidar - MIT License (c) 2012 Paul Miller (paulmillr.com) */
const Gt = "/", si = "//", un = ".", oi = "..", ai = "string", ci = /\\/g, Ne = /\/\//, li = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/, ui = /^\.[/\\]/;
function Ct(e) {
  return Array.isArray(e) ? e : [e];
}
const Kt = (e) => typeof e == "object" && e !== null && !(e instanceof RegExp);
function fi(e) {
  return typeof e == "function" ? e : typeof e == "string" ? (t) => e === t : e instanceof RegExp ? (t) => e.test(t) : typeof e == "object" && e !== null ? (t) => {
    if (e.path === t)
      return !0;
    if (e.recursive) {
      const n = p.relative(e.path, t);
      return n ? !n.startsWith("..") && !p.isAbsolute(n) : !1;
    }
    return !1;
  } : () => !1;
}
function di(e) {
  if (typeof e != "string")
    throw new Error("string expected");
  e = p.normalize(e), e = e.replace(/\\/g, "/");
  let t = !1;
  e.startsWith("//") && (t = !0);
  const n = /\/\//;
  for (; e.match(n); )
    e = e.replace(n, "/");
  return t && (e = "/" + e), e;
}
function hi(e, t, n) {
  const i = di(t);
  for (let r = 0; r < e.length; r++) {
    const s = e[r];
    if (s(i, n))
      return !0;
  }
  return !1;
}
function mi(e, t) {
  if (e == null)
    throw new TypeError("anymatch: specify first argument");
  const i = Ct(e).map((r) => fi(r));
  return (r, s) => hi(i, r, s);
}
const $e = (e) => {
  const t = Ct(e).flat();
  if (!t.every((n) => typeof n === ai))
    throw new TypeError(`Non-string provided as watch path: ${t}`);
  return t.map(fn);
}, Ce = (e) => {
  let t = e.replace(ci, Gt), n = !1;
  for (t.startsWith(si) && (n = !0); t.match(Ne); )
    t = t.replace(Ne, Gt);
  return n && (t = Gt + t), t;
}, fn = (e) => Ce(p.normalize(Ce(e))), Le = (e = "") => (t) => typeof t == "string" ? fn(p.isAbsolute(t) ? t : p.join(e, t)) : t, pi = (e, t) => p.isAbsolute(e) ? e : p.join(t, e), yi = Object.freeze(/* @__PURE__ */ new Set());
class wi {
  constructor(t, n) {
    this.path = t, this._removeWatcher = n, this.items = /* @__PURE__ */ new Set();
  }
  add(t) {
    const { items: n } = this;
    n && t !== un && t !== oi && n.add(t);
  }
  async remove(t) {
    const { items: n } = this;
    if (!n || (n.delete(t), n.size > 0))
      return;
    const i = this.path;
    try {
      await lr(i);
    } catch {
      this._removeWatcher && this._removeWatcher(p.dirname(i), p.basename(i));
    }
  }
  has(t) {
    const { items: n } = this;
    if (n)
      return n.has(t);
  }
  getChildren() {
    const { items: t } = this;
    return t ? [...t.values()] : [];
  }
  dispose() {
    this.items.clear(), this.path = "", this._removeWatcher = le, this.items = yi, Object.freeze(this);
  }
}
const Ei = "stat", _i = "lstat";
class gi {
  constructor(t, n, i) {
    this.fsw = i;
    const r = t;
    this.path = t = t.replace(ui, ""), this.watchPath = r, this.fullWatchPath = p.resolve(r), this.dirParts = [], this.dirParts.forEach((s) => {
      s.length > 1 && s.pop();
    }), this.followSymlinks = n, this.statMethod = n ? Ei : _i;
  }
  entryPath(t) {
    return p.join(this.watchPath, p.relative(this.watchPath, t.fullPath));
  }
  filterPath(t) {
    const { stats: n } = t;
    if (n && n.isSymbolicLink())
      return this.filterDir(t);
    const i = this.entryPath(t);
    return this.fsw._isntIgnored(i, n) && this.fsw._hasReadPermissions(n);
  }
  filterDir(t) {
    return this.fsw._isntIgnored(this.entryPath(t), t.stats);
  }
}
class Si extends ur {
  // Not indenting methods for history sake; for now.
  constructor(t = {}) {
    super(), this.closed = !1, this._closers = /* @__PURE__ */ new Map(), this._ignoredPaths = /* @__PURE__ */ new Set(), this._throttled = /* @__PURE__ */ new Map(), this._streams = /* @__PURE__ */ new Set(), this._symlinkPaths = /* @__PURE__ */ new Map(), this._watched = /* @__PURE__ */ new Map(), this._pendingWrites = /* @__PURE__ */ new Map(), this._pendingUnlinks = /* @__PURE__ */ new Map(), this._readyCount = 0, this._readyEmitted = !1;
    const n = t.awaitWriteFinish, i = { stabilityThreshold: 2e3, pollInterval: 100 }, r = {
      // Defaults
      persistent: !0,
      ignoreInitial: !1,
      ignorePermissionErrors: !1,
      interval: 100,
      binaryInterval: 300,
      followSymlinks: !0,
      usePolling: !1,
      // useAsync: false,
      atomic: !0,
      // NOTE: overwritten later (depends on usePolling)
      ...t,
      // Change format
      ignored: t.ignored ? Ct(t.ignored) : Ct([]),
      awaitWriteFinish: n === !0 ? i : typeof n == "object" ? { ...i, ...n } : !1
    };
    Jr && (r.usePolling = !0), r.atomic === void 0 && (r.atomic = !r.usePolling);
    const s = process.env.CHOKIDAR_USEPOLLING;
    if (s !== void 0) {
      const l = s.toLowerCase();
      l === "false" || l === "0" ? r.usePolling = !1 : l === "true" || l === "1" ? r.usePolling = !0 : r.usePolling = !!l;
    }
    const o = process.env.CHOKIDAR_INTERVAL;
    o && (r.interval = Number.parseInt(o, 10));
    let a = 0;
    this._emitReady = () => {
      a++, a >= this._readyCount && (this._emitReady = le, this._readyEmitted = !0, process.nextTick(() => this.emit(I.READY)));
    }, this._emitRaw = (...l) => this.emit(I.RAW, ...l), this._boundRemove = this._remove.bind(this), this.options = r, this._nodeFsHandler = new ii(this), Object.freeze(r);
  }
  _addIgnoredPath(t) {
    if (Kt(t)) {
      for (const n of this._ignoredPaths)
        if (Kt(n) && n.path === t.path && n.recursive === t.recursive)
          return;
    }
    this._ignoredPaths.add(t);
  }
  _removeIgnoredPath(t) {
    if (this._ignoredPaths.delete(t), typeof t == "string")
      for (const n of this._ignoredPaths)
        Kt(n) && n.path === t && this._ignoredPaths.delete(n);
  }
  // Public methods
  /**
   * Adds paths to be watched on an existing FSWatcher instance.
   * @param paths_ file or file list. Other arguments are unused
   */
  add(t, n, i) {
    const { cwd: r } = this.options;
    this.closed = !1, this._closePromise = void 0;
    let s = $e(t);
    return r && (s = s.map((o) => pi(o, r))), s.forEach((o) => {
      this._removeIgnoredPath(o);
    }), this._userIgnored = void 0, this._readyCount || (this._readyCount = 0), this._readyCount += s.length, Promise.all(s.map(async (o) => {
      const a = await this._nodeFsHandler._addToNodeFs(o, !i, void 0, 0, n);
      return a && this._emitReady(), a;
    })).then((o) => {
      this.closed || o.forEach((a) => {
        a && this.add(p.dirname(a), p.basename(n || a));
      });
    }), this;
  }
  /**
   * Close watchers or start ignoring events from specified paths.
   */
  unwatch(t) {
    if (this.closed)
      return this;
    const n = $e(t), { cwd: i } = this.options;
    return n.forEach((r) => {
      !p.isAbsolute(r) && !this._closers.has(r) && (i && (r = p.join(i, r)), r = p.resolve(r)), this._closePath(r), this._addIgnoredPath(r), this._watched.has(r) && this._addIgnoredPath({
        path: r,
        recursive: !0
      }), this._userIgnored = void 0;
    }), this;
  }
  /**
   * Close watchers and remove all listeners from watched paths.
   */
  close() {
    if (this._closePromise)
      return this._closePromise;
    this.closed = !0, this.removeAllListeners();
    const t = [];
    return this._closers.forEach((n) => n.forEach((i) => {
      const r = i();
      r instanceof Promise && t.push(r);
    })), this._streams.forEach((n) => n.destroy()), this._userIgnored = void 0, this._readyCount = 0, this._readyEmitted = !1, this._watched.forEach((n) => n.dispose()), this._closers.clear(), this._watched.clear(), this._streams.clear(), this._symlinkPaths.clear(), this._throttled.clear(), this._closePromise = t.length ? Promise.all(t).then(() => {
    }) : Promise.resolve(), this._closePromise;
  }
  /**
   * Expose list of watched paths
   * @returns for chaining
   */
  getWatched() {
    const t = {};
    return this._watched.forEach((n, i) => {
      const s = (this.options.cwd ? p.relative(this.options.cwd, i) : i) || un;
      t[s] = n.getChildren().sort();
    }), t;
  }
  emitWithAll(t, n) {
    this.emit(t, ...n), t !== I.ERROR && this.emit(I.ALL, t, ...n);
  }
  // Common helpers
  // --------------
  /**
   * Normalize and emit events.
   * Calling _emit DOES NOT MEAN emit() would be called!
   * @param event Type of event
   * @param path File or directory path
   * @param stats arguments to be passed with event
   * @returns the error if defined, otherwise the value of the FSWatcher instance's `closed` flag
   */
  async _emit(t, n, i) {
    if (this.closed)
      return;
    const r = this.options;
    cn && (n = p.normalize(n)), r.cwd && (n = p.relative(r.cwd, n));
    const s = [n];
    i != null && s.push(i);
    const o = r.awaitWriteFinish;
    let a;
    if (o && (a = this._pendingWrites.get(n)))
      return a.lastChange = /* @__PURE__ */ new Date(), this;
    if (r.atomic) {
      if (t === I.UNLINK)
        return this._pendingUnlinks.set(n, [t, ...s]), setTimeout(() => {
          this._pendingUnlinks.forEach((l, f) => {
            this.emit(...l), this.emit(I.ALL, ...l), this._pendingUnlinks.delete(f);
          });
        }, typeof r.atomic == "number" ? r.atomic : 100), this;
      t === I.ADD && this._pendingUnlinks.has(n) && (t = I.CHANGE, this._pendingUnlinks.delete(n));
    }
    if (o && (t === I.ADD || t === I.CHANGE) && this._readyEmitted) {
      const l = (f, c) => {
        f ? (t = I.ERROR, s[0] = f, this.emitWithAll(t, s)) : c && (s.length > 1 ? s[1] = c : s.push(c), this.emitWithAll(t, s));
      };
      return this._awaitWriteFinish(n, o.stabilityThreshold, t, l), this;
    }
    if (t === I.CHANGE && !this._throttle(I.CHANGE, n, 50))
      return this;
    if (r.alwaysStat && i === void 0 && (t === I.ADD || t === I.ADD_DIR || t === I.CHANGE)) {
      const l = r.cwd ? p.join(r.cwd, n) : n;
      let f;
      try {
        f = await oe(l);
      } catch {
      }
      if (!f || this.closed)
        return;
      s.push(f);
    }
    return this.emitWithAll(t, s), this;
  }
  /**
   * Common handler for errors
   * @returns The error if defined, otherwise the value of the FSWatcher instance's `closed` flag
   */
  _handleError(t) {
    const n = t && t.code;
    return t && n !== "ENOENT" && n !== "ENOTDIR" && (!this.options.ignorePermissionErrors || n !== "EPERM" && n !== "EACCES") && this.emit(I.ERROR, t), t || this.closed;
  }
  /**
   * Helper utility for throttling
   * @param actionType type being throttled
   * @param path being acted upon
   * @param timeout duration of time to suppress duplicate actions
   * @returns tracking object or false if action should be suppressed
   */
  _throttle(t, n, i) {
    this._throttled.has(t) || this._throttled.set(t, /* @__PURE__ */ new Map());
    const r = this._throttled.get(t);
    if (!r)
      throw new Error("invalid throttle");
    const s = r.get(n);
    if (s)
      return s.count++, !1;
    let o;
    const a = () => {
      const f = r.get(n), c = f ? f.count : 0;
      return r.delete(n), clearTimeout(o), f && clearTimeout(f.timeoutObject), c;
    };
    o = setTimeout(a, i);
    const l = { timeoutObject: o, clear: a, count: 0 };
    return r.set(n, l), l;
  }
  _incrReadyCount() {
    return this._readyCount++;
  }
  /**
   * Awaits write operation to finish.
   * Polls a newly created file for size variations. When files size does not change for 'threshold' milliseconds calls callback.
   * @param path being acted upon
   * @param threshold Time in milliseconds a file size must be fixed before acknowledging write OP is finished
   * @param event
   * @param awfEmit Callback to be called when ready for event to be emitted.
   */
  _awaitWriteFinish(t, n, i, r) {
    const s = this.options.awaitWriteFinish;
    if (typeof s != "object")
      return;
    const o = s.pollInterval;
    let a, l = t;
    this.options.cwd && !p.isAbsolute(t) && (l = p.join(this.options.cwd, t));
    const f = /* @__PURE__ */ new Date(), c = this._pendingWrites;
    function u(d) {
      or(l, (h, m) => {
        if (h || !c.has(t)) {
          h && h.code !== "ENOENT" && r(h);
          return;
        }
        const w = Number(/* @__PURE__ */ new Date());
        d && m.size !== d.size && (c.get(t).lastChange = w);
        const _ = c.get(t);
        w - _.lastChange >= n ? (c.delete(t), r(void 0, m)) : a = setTimeout(u, o, m);
      });
    }
    c.has(t) || (c.set(t, {
      lastChange: f,
      cancelWait: () => (c.delete(t), clearTimeout(a), i)
    }), a = setTimeout(u, o));
  }
  /**
   * Determines whether user has asked to ignore this path.
   */
  _isIgnored(t, n) {
    if (this.options.atomic && li.test(t))
      return !0;
    if (!this._userIgnored) {
      const { cwd: i } = this.options, s = (this.options.ignored || []).map(Le(i)), a = [...[...this._ignoredPaths].map(Le(i)), ...s];
      this._userIgnored = mi(a);
    }
    return this._userIgnored(t, n);
  }
  _isntIgnored(t, n) {
    return !this._isIgnored(t, n);
  }
  /**
   * Provides a set of common helpers and properties relating to symlink handling.
   * @param path file or directory pattern being watched
   */
  _getWatchHelpers(t) {
    return new gi(t, this.options.followSymlinks, this);
  }
  // Directory helpers
  // -----------------
  /**
   * Provides directory tracking objects
   * @param directory path of the directory
   */
  _getWatchedDir(t) {
    const n = p.resolve(t);
    return this._watched.has(n) || this._watched.set(n, new wi(n, this._boundRemove)), this._watched.get(n);
  }
  // File helpers
  // ------------
  /**
   * Check for read permissions: https://stackoverflow.com/a/11781404/1358405
   */
  _hasReadPermissions(t) {
    return this.options.ignorePermissionErrors ? !0 : !!(Number(t.mode) & 256);
  }
  /**
   * Handles emitting unlink events for
   * files and directories, and via recursion, for
   * files and directories within directories that are unlinked
   * @param directory within which the following item is located
   * @param item      base path of item/directory
   */
  _remove(t, n, i) {
    const r = p.join(t, n), s = p.resolve(r);
    if (i = i ?? (this._watched.has(r) || this._watched.has(s)), !this._throttle("remove", r, 100))
      return;
    !i && this._watched.size === 1 && this.add(t, n, !0), this._getWatchedDir(r).getChildren().forEach((d) => this._remove(r, d));
    const l = this._getWatchedDir(t), f = l.has(n);
    l.remove(n), this._symlinkPaths.has(s) && this._symlinkPaths.delete(s);
    let c = r;
    if (this.options.cwd && (c = p.relative(this.options.cwd, r)), this.options.awaitWriteFinish && this._pendingWrites.has(c) && this._pendingWrites.get(c).cancelWait() === I.ADD)
      return;
    this._watched.delete(r), this._watched.delete(s);
    const u = i ? I.UNLINK_DIR : I.UNLINK;
    f && !this._isIgnored(r) && this._emit(u, r), this._closePath(r);
  }
  /**
   * Closes all watchers for a path
   */
  _closePath(t) {
    this._closeFile(t);
    const n = p.dirname(t);
    this._getWatchedDir(n).remove(p.basename(t));
  }
  /**
   * Closes only file-specific watchers
   */
  _closeFile(t) {
    const n = this._closers.get(t);
    n && (n.forEach((i) => i()), this._closers.delete(t));
  }
  _addPathCloser(t, n) {
    if (!n)
      return;
    let i = this._closers.get(t);
    i || (i = [], this._closers.set(t, i)), i.push(n);
  }
  _readdirp(t, n) {
    if (this.closed)
      return;
    const i = { type: I.ALL, alwaysStat: !0, lstat: !0, ...n, depth: 0 };
    let r = Hr(t, i);
    return this._streams.add(r), r.once(Br, () => {
      r = void 0;
    }), r.once(an, () => {
      r && (this._streams.delete(r), r = void 0);
    }), r;
  }
}
function vi(e, t = {}) {
  const n = new Si(t);
  return n.add(e), n;
}
var te = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function Pi(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var Y = {}, O = {};
O.fromCallback = function(e) {
  return Object.defineProperty(function(...t) {
    if (typeof t[t.length - 1] == "function") e.apply(this, t);
    else
      return new Promise((n, i) => {
        t.push((r, s) => r != null ? i(r) : n(s)), e.apply(this, t);
      });
  }, "name", { value: e.name });
};
O.fromPromise = function(e) {
  return Object.defineProperty(function(...t) {
    const n = t[t.length - 1];
    if (typeof n != "function") return e.apply(this, t);
    t.pop(), e.apply(this, t).then((i) => n(null, i), n);
  }, "name", { value: e.name });
};
var Q = yr, Ri = process.cwd, Nt = null, bi = process.env.GRACEFUL_FS_PLATFORM || process.platform;
process.cwd = function() {
  return Nt || (Nt = Ri.call(process)), Nt;
};
try {
  process.cwd();
} catch {
}
if (typeof process.chdir == "function") {
  var Ae = process.chdir;
  process.chdir = function(e) {
    Nt = null, Ae.call(process, e);
  }, Object.setPrototypeOf && Object.setPrototypeOf(process.chdir, Ae);
}
var Ti = Fi;
function Fi(e) {
  Q.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./) && t(e), e.lutimes || n(e), e.chown = s(e.chown), e.fchown = s(e.fchown), e.lchown = s(e.lchown), e.chmod = i(e.chmod), e.fchmod = i(e.fchmod), e.lchmod = i(e.lchmod), e.chownSync = o(e.chownSync), e.fchownSync = o(e.fchownSync), e.lchownSync = o(e.lchownSync), e.chmodSync = r(e.chmodSync), e.fchmodSync = r(e.fchmodSync), e.lchmodSync = r(e.lchmodSync), e.stat = a(e.stat), e.fstat = a(e.fstat), e.lstat = a(e.lstat), e.statSync = l(e.statSync), e.fstatSync = l(e.fstatSync), e.lstatSync = l(e.lstatSync), e.chmod && !e.lchmod && (e.lchmod = function(c, u, d) {
    d && process.nextTick(d);
  }, e.lchmodSync = function() {
  }), e.chown && !e.lchown && (e.lchown = function(c, u, d, h) {
    h && process.nextTick(h);
  }, e.lchownSync = function() {
  }), bi === "win32" && (e.rename = typeof e.rename != "function" ? e.rename : function(c) {
    function u(d, h, m) {
      var w = Date.now(), _ = 0;
      c(d, h, function P(H) {
        if (H && (H.code === "EACCES" || H.code === "EPERM" || H.code === "EBUSY") && Date.now() - w < 6e4) {
          setTimeout(function() {
            e.stat(h, function(W, mt) {
              W && W.code === "ENOENT" ? c(d, h, P) : m(H);
            });
          }, _), _ < 100 && (_ += 10);
          return;
        }
        m && m(H);
      });
    }
    return Object.setPrototypeOf && Object.setPrototypeOf(u, c), u;
  }(e.rename)), e.read = typeof e.read != "function" ? e.read : function(c) {
    function u(d, h, m, w, _, P) {
      var H;
      if (P && typeof P == "function") {
        var W = 0;
        H = function(mt, Se, ve) {
          if (mt && mt.code === "EAGAIN" && W < 10)
            return W++, c.call(e, d, h, m, w, _, H);
          P.apply(this, arguments);
        };
      }
      return c.call(e, d, h, m, w, _, H);
    }
    return Object.setPrototypeOf && Object.setPrototypeOf(u, c), u;
  }(e.read), e.readSync = typeof e.readSync != "function" ? e.readSync : /* @__PURE__ */ function(c) {
    return function(u, d, h, m, w) {
      for (var _ = 0; ; )
        try {
          return c.call(e, u, d, h, m, w);
        } catch (P) {
          if (P.code === "EAGAIN" && _ < 10) {
            _++;
            continue;
          }
          throw P;
        }
    };
  }(e.readSync);
  function t(c) {
    c.lchmod = function(u, d, h) {
      c.open(
        u,
        Q.O_WRONLY | Q.O_SYMLINK,
        d,
        function(m, w) {
          if (m) {
            h && h(m);
            return;
          }
          c.fchmod(w, d, function(_) {
            c.close(w, function(P) {
              h && h(_ || P);
            });
          });
        }
      );
    }, c.lchmodSync = function(u, d) {
      var h = c.openSync(u, Q.O_WRONLY | Q.O_SYMLINK, d), m = !0, w;
      try {
        w = c.fchmodSync(h, d), m = !1;
      } finally {
        if (m)
          try {
            c.closeSync(h);
          } catch {
          }
        else
          c.closeSync(h);
      }
      return w;
    };
  }
  function n(c) {
    Q.hasOwnProperty("O_SYMLINK") && c.futimes ? (c.lutimes = function(u, d, h, m) {
      c.open(u, Q.O_SYMLINK, function(w, _) {
        if (w) {
          m && m(w);
          return;
        }
        c.futimes(_, d, h, function(P) {
          c.close(_, function(H) {
            m && m(P || H);
          });
        });
      });
    }, c.lutimesSync = function(u, d, h) {
      var m = c.openSync(u, Q.O_SYMLINK), w, _ = !0;
      try {
        w = c.futimesSync(m, d, h), _ = !1;
      } finally {
        if (_)
          try {
            c.closeSync(m);
          } catch {
          }
        else
          c.closeSync(m);
      }
      return w;
    }) : c.futimes && (c.lutimes = function(u, d, h, m) {
      m && process.nextTick(m);
    }, c.lutimesSync = function() {
    });
  }
  function i(c) {
    return c && function(u, d, h) {
      return c.call(e, u, d, function(m) {
        f(m) && (m = null), h && h.apply(this, arguments);
      });
    };
  }
  function r(c) {
    return c && function(u, d) {
      try {
        return c.call(e, u, d);
      } catch (h) {
        if (!f(h)) throw h;
      }
    };
  }
  function s(c) {
    return c && function(u, d, h, m) {
      return c.call(e, u, d, h, function(w) {
        f(w) && (w = null), m && m.apply(this, arguments);
      });
    };
  }
  function o(c) {
    return c && function(u, d, h) {
      try {
        return c.call(e, u, d, h);
      } catch (m) {
        if (!f(m)) throw m;
      }
    };
  }
  function a(c) {
    return c && function(u, d, h) {
      typeof d == "function" && (h = d, d = null);
      function m(w, _) {
        _ && (_.uid < 0 && (_.uid += 4294967296), _.gid < 0 && (_.gid += 4294967296)), h && h.apply(this, arguments);
      }
      return d ? c.call(e, u, d, m) : c.call(e, u, m);
    };
  }
  function l(c) {
    return c && function(u, d) {
      var h = d ? c.call(e, u, d) : c.call(e, u);
      return h && (h.uid < 0 && (h.uid += 4294967296), h.gid < 0 && (h.gid += 4294967296)), h;
    };
  }
  function f(c) {
    if (!c || c.code === "ENOSYS")
      return !0;
    var u = !process.getuid || process.getuid() !== 0;
    return !!(u && (c.code === "EINVAL" || c.code === "EPERM"));
  }
}
var xe = wr.Stream, Di = ki;
function ki(e) {
  return {
    ReadStream: t,
    WriteStream: n
  };
  function t(i, r) {
    if (!(this instanceof t)) return new t(i, r);
    xe.call(this);
    var s = this;
    this.path = i, this.fd = null, this.readable = !0, this.paused = !1, this.flags = "r", this.mode = 438, this.bufferSize = 64 * 1024, r = r || {};
    for (var o = Object.keys(r), a = 0, l = o.length; a < l; a++) {
      var f = o[a];
      this[f] = r[f];
    }
    if (this.encoding && this.setEncoding(this.encoding), this.start !== void 0) {
      if (typeof this.start != "number")
        throw TypeError("start must be a Number");
      if (this.end === void 0)
        this.end = 1 / 0;
      else if (typeof this.end != "number")
        throw TypeError("end must be a Number");
      if (this.start > this.end)
        throw new Error("start must be <= end");
      this.pos = this.start;
    }
    if (this.fd !== null) {
      process.nextTick(function() {
        s._read();
      });
      return;
    }
    e.open(this.path, this.flags, this.mode, function(c, u) {
      if (c) {
        s.emit("error", c), s.readable = !1;
        return;
      }
      s.fd = u, s.emit("open", u), s._read();
    });
  }
  function n(i, r) {
    if (!(this instanceof n)) return new n(i, r);
    xe.call(this), this.path = i, this.fd = null, this.writable = !0, this.flags = "w", this.encoding = "binary", this.mode = 438, this.bytesWritten = 0, r = r || {};
    for (var s = Object.keys(r), o = 0, a = s.length; o < a; o++) {
      var l = s[o];
      this[l] = r[l];
    }
    if (this.start !== void 0) {
      if (typeof this.start != "number")
        throw TypeError("start must be a Number");
      if (this.start < 0)
        throw new Error("start must be >= zero");
      this.pos = this.start;
    }
    this.busy = !1, this._queue = [], this.fd === null && (this._open = e.open, this._queue.push([this._open, this.path, this.flags, this.mode, void 0]), this.flush());
  }
}
var Ii = Ni, Oi = Object.getPrototypeOf || function(e) {
  return e.__proto__;
};
function Ni(e) {
  if (e === null || typeof e != "object")
    return e;
  if (e instanceof Object)
    var t = { __proto__: Oi(e) };
  else
    var t = /* @__PURE__ */ Object.create(null);
  return Object.getOwnPropertyNames(e).forEach(function(n) {
    Object.defineProperty(t, n, Object.getOwnPropertyDescriptor(e, n));
  }), t;
}
var T = Ze, $i = Ti, Ci = Di, Li = Ii, Rt = Er, x, Lt;
typeof Symbol == "function" && typeof Symbol.for == "function" ? (x = Symbol.for("graceful-fs.queue"), Lt = Symbol.for("graceful-fs.previous")) : (x = "___graceful-fs.queue", Lt = "___graceful-fs.previous");
function Ai() {
}
function dn(e, t) {
  Object.defineProperty(e, x, {
    get: function() {
      return t;
    }
  });
}
var st = Ai;
Rt.debuglog ? st = Rt.debuglog("gfs4") : /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && (st = function() {
  var e = Rt.format.apply(Rt, arguments);
  e = "GFS4: " + e.split(/\n/).join(`
GFS4: `), console.error(e);
});
if (!T[x]) {
  var xi = te[x] || [];
  dn(T, xi), T.close = function(e) {
    function t(n, i) {
      return e.call(T, n, function(r) {
        r || Me(), typeof i == "function" && i.apply(this, arguments);
      });
    }
    return Object.defineProperty(t, Lt, {
      value: e
    }), t;
  }(T.close), T.closeSync = function(e) {
    function t(n) {
      e.apply(T, arguments), Me();
    }
    return Object.defineProperty(t, Lt, {
      value: e
    }), t;
  }(T.closeSync), /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && process.on("exit", function() {
    st(T[x]), _r.equal(T[x].length, 0);
  });
}
te[x] || dn(te, T[x]);
var dt = ue(Li(T));
process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !T.__patched && (dt = ue(T), T.__patched = !0);
function ue(e) {
  $i(e), e.gracefulify = ue, e.createReadStream = Se, e.createWriteStream = ve;
  var t = e.readFile;
  e.readFile = n;
  function n(y, g, E) {
    return typeof g == "function" && (E = g, g = null), C(y, g, E);
    function C(L, N, b, D) {
      return t(L, N, function(S) {
        S && (S.code === "EMFILE" || S.code === "ENFILE") ? at([C, [L, N, b], S, D || Date.now(), Date.now()]) : typeof b == "function" && b.apply(this, arguments);
      });
    }
  }
  var i = e.writeFile;
  e.writeFile = r;
  function r(y, g, E, C) {
    return typeof E == "function" && (C = E, E = null), L(y, g, E, C);
    function L(N, b, D, S, A) {
      return i(N, b, D, function(R) {
        R && (R.code === "EMFILE" || R.code === "ENFILE") ? at([L, [N, b, D, S], R, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  var s = e.appendFile;
  s && (e.appendFile = o);
  function o(y, g, E, C) {
    return typeof E == "function" && (C = E, E = null), L(y, g, E, C);
    function L(N, b, D, S, A) {
      return s(N, b, D, function(R) {
        R && (R.code === "EMFILE" || R.code === "ENFILE") ? at([L, [N, b, D, S], R, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  var a = e.copyFile;
  a && (e.copyFile = l);
  function l(y, g, E, C) {
    return typeof E == "function" && (C = E, E = 0), L(y, g, E, C);
    function L(N, b, D, S, A) {
      return a(N, b, D, function(R) {
        R && (R.code === "EMFILE" || R.code === "ENFILE") ? at([L, [N, b, D, S], R, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  var f = e.readdir;
  e.readdir = u;
  var c = /^v[0-5]\./;
  function u(y, g, E) {
    typeof g == "function" && (E = g, g = null);
    var C = c.test(process.version) ? function(b, D, S, A) {
      return f(b, L(
        b,
        D,
        S,
        A
      ));
    } : function(b, D, S, A) {
      return f(b, D, L(
        b,
        D,
        S,
        A
      ));
    };
    return C(y, g, E);
    function L(N, b, D, S) {
      return function(A, R) {
        A && (A.code === "EMFILE" || A.code === "ENFILE") ? at([
          C,
          [N, b, D],
          A,
          S || Date.now(),
          Date.now()
        ]) : (R && R.sort && R.sort(), typeof D == "function" && D.call(this, A, R));
      };
    }
  }
  if (process.version.substr(0, 4) === "v0.8") {
    var d = Ci(e);
    P = d.ReadStream, W = d.WriteStream;
  }
  var h = e.ReadStream;
  h && (P.prototype = Object.create(h.prototype), P.prototype.open = H);
  var m = e.WriteStream;
  m && (W.prototype = Object.create(m.prototype), W.prototype.open = mt), Object.defineProperty(e, "ReadStream", {
    get: function() {
      return P;
    },
    set: function(y) {
      P = y;
    },
    enumerable: !0,
    configurable: !0
  }), Object.defineProperty(e, "WriteStream", {
    get: function() {
      return W;
    },
    set: function(y) {
      W = y;
    },
    enumerable: !0,
    configurable: !0
  });
  var w = P;
  Object.defineProperty(e, "FileReadStream", {
    get: function() {
      return w;
    },
    set: function(y) {
      w = y;
    },
    enumerable: !0,
    configurable: !0
  });
  var _ = W;
  Object.defineProperty(e, "FileWriteStream", {
    get: function() {
      return _;
    },
    set: function(y) {
      _ = y;
    },
    enumerable: !0,
    configurable: !0
  });
  function P(y, g) {
    return this instanceof P ? (h.apply(this, arguments), this) : P.apply(Object.create(P.prototype), arguments);
  }
  function H() {
    var y = this;
    Yt(y.path, y.flags, y.mode, function(g, E) {
      g ? (y.autoClose && y.destroy(), y.emit("error", g)) : (y.fd = E, y.emit("open", E), y.read());
    });
  }
  function W(y, g) {
    return this instanceof W ? (m.apply(this, arguments), this) : W.apply(Object.create(W.prototype), arguments);
  }
  function mt() {
    var y = this;
    Yt(y.path, y.flags, y.mode, function(g, E) {
      g ? (y.destroy(), y.emit("error", g)) : (y.fd = E, y.emit("open", E));
    });
  }
  function Se(y, g) {
    return new e.ReadStream(y, g);
  }
  function ve(y, g) {
    return new e.WriteStream(y, g);
  }
  var Qn = e.open;
  e.open = Yt;
  function Yt(y, g, E, C) {
    return typeof E == "function" && (C = E, E = null), L(y, g, E, C);
    function L(N, b, D, S, A) {
      return Qn(N, b, D, function(R, ia) {
        R && (R.code === "EMFILE" || R.code === "ENFILE") ? at([L, [N, b, D, S], R, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  return e;
}
function at(e) {
  st("ENQUEUE", e[0].name, e[1]), T[x].push(e), fe();
}
var bt;
function Me() {
  for (var e = Date.now(), t = 0; t < T[x].length; ++t)
    T[x][t].length > 2 && (T[x][t][3] = e, T[x][t][4] = e);
  fe();
}
function fe() {
  if (clearTimeout(bt), bt = void 0, T[x].length !== 0) {
    var e = T[x].shift(), t = e[0], n = e[1], i = e[2], r = e[3], s = e[4];
    if (r === void 0)
      st("RETRY", t.name, n), t.apply(null, n);
    else if (Date.now() - r >= 6e4) {
      st("TIMEOUT", t.name, n);
      var o = n.pop();
      typeof o == "function" && o.call(null, i);
    } else {
      var a = Date.now() - s, l = Math.max(s - r, 1), f = Math.min(l * 1.2, 100);
      a >= f ? (st("RETRY", t.name, n), t.apply(null, n.concat([r]))) : T[x].push(e);
    }
    bt === void 0 && (bt = setTimeout(fe, 0));
  }
}
(function(e) {
  const t = O.fromCallback, n = dt, i = [
    "access",
    "appendFile",
    "chmod",
    "chown",
    "close",
    "copyFile",
    "cp",
    "fchmod",
    "fchown",
    "fdatasync",
    "fstat",
    "fsync",
    "ftruncate",
    "futimes",
    "glob",
    "lchmod",
    "lchown",
    "lutimes",
    "link",
    "lstat",
    "mkdir",
    "mkdtemp",
    "open",
    "opendir",
    "readdir",
    "readFile",
    "readlink",
    "realpath",
    "rename",
    "rm",
    "rmdir",
    "stat",
    "statfs",
    "symlink",
    "truncate",
    "unlink",
    "utimes",
    "writeFile"
  ].filter((r) => typeof n[r] == "function");
  Object.assign(e, n), i.forEach((r) => {
    e[r] = t(n[r]);
  }), e.exists = function(r, s) {
    return typeof s == "function" ? n.exists(r, s) : new Promise((o) => n.exists(r, o));
  }, e.read = function(r, s, o, a, l, f) {
    return typeof f == "function" ? n.read(r, s, o, a, l, f) : new Promise((c, u) => {
      n.read(r, s, o, a, l, (d, h, m) => {
        if (d) return u(d);
        c({ bytesRead: h, buffer: m });
      });
    });
  }, e.write = function(r, s, ...o) {
    return typeof o[o.length - 1] == "function" ? n.write(r, s, ...o) : new Promise((a, l) => {
      n.write(r, s, ...o, (f, c, u) => {
        if (f) return l(f);
        a({ bytesWritten: c, buffer: u });
      });
    });
  }, e.readv = function(r, s, ...o) {
    return typeof o[o.length - 1] == "function" ? n.readv(r, s, ...o) : new Promise((a, l) => {
      n.readv(r, s, ...o, (f, c, u) => {
        if (f) return l(f);
        a({ bytesRead: c, buffers: u });
      });
    });
  }, e.writev = function(r, s, ...o) {
    return typeof o[o.length - 1] == "function" ? n.writev(r, s, ...o) : new Promise((a, l) => {
      n.writev(r, s, ...o, (f, c, u) => {
        if (f) return l(f);
        a({ bytesWritten: c, buffers: u });
      });
    });
  }, typeof n.realpath.native == "function" ? e.realpath.native = t(n.realpath.native) : process.emitWarning(
    "fs.realpath.native is not a function. Is fs being monkey-patched?",
    "Warning",
    "fs-extra-WARN0003"
  );
})(Y);
var de = {}, hn = {};
const Mi = F;
hn.checkPath = function(t) {
  if (process.platform === "win32" && /[<>:"|?*]/.test(t.replace(Mi.parse(t).root, ""))) {
    const i = new Error(`Path contains invalid characters: ${t}`);
    throw i.code = "EINVAL", i;
  }
};
const mn = Y, { checkPath: pn } = hn, yn = (e) => {
  const t = { mode: 511 };
  return typeof e == "number" ? e : { ...t, ...e }.mode;
};
de.makeDir = async (e, t) => (pn(e), mn.mkdir(e, {
  mode: yn(t),
  recursive: !0
}));
de.makeDirSync = (e, t) => (pn(e), mn.mkdirSync(e, {
  mode: yn(t),
  recursive: !0
}));
const Wi = O.fromPromise, { makeDir: ji, makeDirSync: Vt } = de, Jt = Wi(ji);
var X = {
  mkdirs: Jt,
  mkdirsSync: Vt,
  // alias
  mkdirp: Jt,
  mkdirpSync: Vt,
  ensureDir: Jt,
  ensureDirSync: Vt
};
const Ui = O.fromPromise, wn = Y;
function Yi(e) {
  return wn.access(e).then(() => !0).catch(() => !1);
}
var ot = {
  pathExists: Ui(Yi),
  pathExistsSync: wn.existsSync
};
const lt = Y, Hi = O.fromPromise;
async function zi(e, t, n) {
  const i = await lt.open(e, "r+");
  let r = null;
  try {
    await lt.futimes(i, t, n);
  } finally {
    try {
      await lt.close(i);
    } catch (s) {
      r = s;
    }
  }
  if (r)
    throw r;
}
function Bi(e, t, n) {
  const i = lt.openSync(e, "r+");
  return lt.futimesSync(i, t, n), lt.closeSync(i);
}
var En = {
  utimesMillis: Hi(zi),
  utimesMillisSync: Bi
};
const ut = Y, $ = F, We = O.fromPromise;
function Gi(e, t, n) {
  const i = n.dereference ? (r) => ut.stat(r, { bigint: !0 }) : (r) => ut.lstat(r, { bigint: !0 });
  return Promise.all([
    i(e),
    i(t).catch((r) => {
      if (r.code === "ENOENT") return null;
      throw r;
    })
  ]).then(([r, s]) => ({ srcStat: r, destStat: s }));
}
function Ki(e, t, n) {
  let i;
  const r = n.dereference ? (o) => ut.statSync(o, { bigint: !0 }) : (o) => ut.lstatSync(o, { bigint: !0 }), s = r(e);
  try {
    i = r(t);
  } catch (o) {
    if (o.code === "ENOENT") return { srcStat: s, destStat: null };
    throw o;
  }
  return { srcStat: s, destStat: i };
}
async function Vi(e, t, n, i) {
  const { srcStat: r, destStat: s } = await Gi(e, t, i);
  if (s) {
    if (vt(r, s)) {
      const o = $.basename(e), a = $.basename(t);
      if (n === "move" && o !== a && o.toLowerCase() === a.toLowerCase())
        return { srcStat: r, destStat: s, isChangingCase: !0 };
      throw new Error("Source and destination must not be the same.");
    }
    if (r.isDirectory() && !s.isDirectory())
      throw new Error(`Cannot overwrite non-directory '${t}' with directory '${e}'.`);
    if (!r.isDirectory() && s.isDirectory())
      throw new Error(`Cannot overwrite directory '${t}' with non-directory '${e}'.`);
  }
  if (r.isDirectory() && he(e, t))
    throw new Error(Mt(e, t, n));
  return { srcStat: r, destStat: s };
}
function Ji(e, t, n, i) {
  const { srcStat: r, destStat: s } = Ki(e, t, i);
  if (s) {
    if (vt(r, s)) {
      const o = $.basename(e), a = $.basename(t);
      if (n === "move" && o !== a && o.toLowerCase() === a.toLowerCase())
        return { srcStat: r, destStat: s, isChangingCase: !0 };
      throw new Error("Source and destination must not be the same.");
    }
    if (r.isDirectory() && !s.isDirectory())
      throw new Error(`Cannot overwrite non-directory '${t}' with directory '${e}'.`);
    if (!r.isDirectory() && s.isDirectory())
      throw new Error(`Cannot overwrite directory '${t}' with non-directory '${e}'.`);
  }
  if (r.isDirectory() && he(e, t))
    throw new Error(Mt(e, t, n));
  return { srcStat: r, destStat: s };
}
async function _n(e, t, n, i) {
  const r = $.resolve($.dirname(e)), s = $.resolve($.dirname(n));
  if (s === r || s === $.parse(s).root) return;
  let o;
  try {
    o = await ut.stat(s, { bigint: !0 });
  } catch (a) {
    if (a.code === "ENOENT") return;
    throw a;
  }
  if (vt(t, o))
    throw new Error(Mt(e, n, i));
  return _n(e, t, s, i);
}
function gn(e, t, n, i) {
  const r = $.resolve($.dirname(e)), s = $.resolve($.dirname(n));
  if (s === r || s === $.parse(s).root) return;
  let o;
  try {
    o = ut.statSync(s, { bigint: !0 });
  } catch (a) {
    if (a.code === "ENOENT") return;
    throw a;
  }
  if (vt(t, o))
    throw new Error(Mt(e, n, i));
  return gn(e, t, s, i);
}
function vt(e, t) {
  return t.ino !== void 0 && t.dev !== void 0 && t.ino === e.ino && t.dev === e.dev;
}
function he(e, t) {
  const n = $.resolve(e).split($.sep).filter((r) => r), i = $.resolve(t).split($.sep).filter((r) => r);
  return n.every((r, s) => i[s] === r);
}
function Mt(e, t, n) {
  return `Cannot ${n} '${e}' to a subdirectory of itself, '${t}'.`;
}
var ht = {
  // checkPaths
  checkPaths: We(Vi),
  checkPathsSync: Ji,
  // checkParent
  checkParentPaths: We(_n),
  checkParentPathsSync: gn,
  // Misc
  isSrcSubdir: he,
  areIdentical: vt
};
async function Xi(e, t) {
  const n = [];
  for await (const i of e)
    n.push(
      t(i).then(
        () => null,
        (r) => r ?? new Error("unknown error")
      )
    );
  await Promise.all(
    n.map(
      (i) => i.then((r) => {
        if (r !== null) throw r;
      })
    )
  );
}
var qi = {
  asyncIteratorConcurrentProcess: Xi
};
const M = Y, Et = F, { mkdirs: Qi } = X, { pathExists: Zi } = ot, { utimesMillis: ts } = En, _t = ht, { asyncIteratorConcurrentProcess: es } = qi;
async function ns(e, t, n = {}) {
  typeof n == "function" && (n = { filter: n }), n.clobber = "clobber" in n ? !!n.clobber : !0, n.overwrite = "overwrite" in n ? !!n.overwrite : n.clobber, n.preserveTimestamps && process.arch === "ia32" && process.emitWarning(
    `Using the preserveTimestamps option in 32-bit node is not recommended;

	see https://github.com/jprichardson/node-fs-extra/issues/269`,
    "Warning",
    "fs-extra-WARN0001"
  );
  const { srcStat: i, destStat: r } = await _t.checkPaths(e, t, "copy", n);
  if (await _t.checkParentPaths(e, i, t, "copy"), !await Sn(e, t, n)) return;
  const o = Et.dirname(t);
  await Zi(o) || await Qi(o), await vn(r, e, t, n);
}
async function Sn(e, t, n) {
  return n.filter ? n.filter(e, t) : !0;
}
async function vn(e, t, n, i) {
  const s = await (i.dereference ? M.stat : M.lstat)(t);
  if (s.isDirectory()) return os(s, e, t, n, i);
  if (s.isFile() || s.isCharacterDevice() || s.isBlockDevice()) return rs(s, e, t, n, i);
  if (s.isSymbolicLink()) return as(e, t, n, i);
  throw s.isSocket() ? new Error(`Cannot copy a socket file: ${t}`) : s.isFIFO() ? new Error(`Cannot copy a FIFO pipe: ${t}`) : new Error(`Unknown file: ${t}`);
}
async function rs(e, t, n, i, r) {
  if (!t) return je(e, n, i, r);
  if (r.overwrite)
    return await M.unlink(i), je(e, n, i, r);
  if (r.errorOnExist)
    throw new Error(`'${i}' already exists`);
}
async function je(e, t, n, i) {
  if (await M.copyFile(t, n), i.preserveTimestamps) {
    is(e.mode) && await ss(n, e.mode);
    const r = await M.stat(t);
    await ts(n, r.atime, r.mtime);
  }
  return M.chmod(n, e.mode);
}
function is(e) {
  return (e & 128) === 0;
}
function ss(e, t) {
  return M.chmod(e, t | 128);
}
async function os(e, t, n, i, r) {
  t || await M.mkdir(i), await es(await M.opendir(n), async (s) => {
    const o = Et.join(n, s.name), a = Et.join(i, s.name);
    if (await Sn(o, a, r)) {
      const { destStat: f } = await _t.checkPaths(o, a, "copy", r);
      await vn(f, o, a, r);
    }
  }), t || await M.chmod(i, e.mode);
}
async function as(e, t, n, i) {
  let r = await M.readlink(t);
  if (i.dereference && (r = Et.resolve(process.cwd(), r)), !e)
    return M.symlink(r, n);
  let s = null;
  try {
    s = await M.readlink(n);
  } catch (o) {
    if (o.code === "EINVAL" || o.code === "UNKNOWN") return M.symlink(r, n);
    throw o;
  }
  if (i.dereference && (s = Et.resolve(process.cwd(), s)), _t.isSrcSubdir(r, s))
    throw new Error(`Cannot copy '${r}' to a subdirectory of itself, '${s}'.`);
  if (_t.isSrcSubdir(s, r))
    throw new Error(`Cannot overwrite '${s}' with '${r}'.`);
  return await M.unlink(n), M.symlink(r, n);
}
var cs = ns;
const j = dt, gt = F, ls = X.mkdirsSync, us = En.utimesMillisSync, St = ht;
function fs(e, t, n) {
  typeof n == "function" && (n = { filter: n }), n = n || {}, n.clobber = "clobber" in n ? !!n.clobber : !0, n.overwrite = "overwrite" in n ? !!n.overwrite : n.clobber, n.preserveTimestamps && process.arch === "ia32" && process.emitWarning(
    `Using the preserveTimestamps option in 32-bit node is not recommended;

	see https://github.com/jprichardson/node-fs-extra/issues/269`,
    "Warning",
    "fs-extra-WARN0002"
  );
  const { srcStat: i, destStat: r } = St.checkPathsSync(e, t, "copy", n);
  if (St.checkParentPathsSync(e, i, t, "copy"), n.filter && !n.filter(e, t)) return;
  const s = gt.dirname(t);
  return j.existsSync(s) || ls(s), Pn(r, e, t, n);
}
function Pn(e, t, n, i) {
  const s = (i.dereference ? j.statSync : j.lstatSync)(t);
  if (s.isDirectory()) return Es(s, e, t, n, i);
  if (s.isFile() || s.isCharacterDevice() || s.isBlockDevice()) return ds(s, e, t, n, i);
  if (s.isSymbolicLink()) return Ss(e, t, n, i);
  throw s.isSocket() ? new Error(`Cannot copy a socket file: ${t}`) : s.isFIFO() ? new Error(`Cannot copy a FIFO pipe: ${t}`) : new Error(`Unknown file: ${t}`);
}
function ds(e, t, n, i, r) {
  return t ? hs(e, n, i, r) : Rn(e, n, i, r);
}
function hs(e, t, n, i) {
  if (i.overwrite)
    return j.unlinkSync(n), Rn(e, t, n, i);
  if (i.errorOnExist)
    throw new Error(`'${n}' already exists`);
}
function Rn(e, t, n, i) {
  return j.copyFileSync(t, n), i.preserveTimestamps && ms(e.mode, t, n), me(n, e.mode);
}
function ms(e, t, n) {
  return ps(e) && ys(n, e), ws(t, n);
}
function ps(e) {
  return (e & 128) === 0;
}
function ys(e, t) {
  return me(e, t | 128);
}
function me(e, t) {
  return j.chmodSync(e, t);
}
function ws(e, t) {
  const n = j.statSync(e);
  return us(t, n.atime, n.mtime);
}
function Es(e, t, n, i, r) {
  return t ? bn(n, i, r) : _s(e.mode, n, i, r);
}
function _s(e, t, n, i) {
  return j.mkdirSync(n), bn(t, n, i), me(n, e);
}
function bn(e, t, n) {
  const i = j.opendirSync(e);
  try {
    let r;
    for (; (r = i.readSync()) !== null; )
      gs(r.name, e, t, n);
  } finally {
    i.closeSync();
  }
}
function gs(e, t, n, i) {
  const r = gt.join(t, e), s = gt.join(n, e);
  if (i.filter && !i.filter(r, s)) return;
  const { destStat: o } = St.checkPathsSync(r, s, "copy", i);
  return Pn(o, r, s, i);
}
function Ss(e, t, n, i) {
  let r = j.readlinkSync(t);
  if (i.dereference && (r = gt.resolve(process.cwd(), r)), e) {
    let s;
    try {
      s = j.readlinkSync(n);
    } catch (o) {
      if (o.code === "EINVAL" || o.code === "UNKNOWN") return j.symlinkSync(r, n);
      throw o;
    }
    if (i.dereference && (s = gt.resolve(process.cwd(), s)), St.isSrcSubdir(r, s))
      throw new Error(`Cannot copy '${r}' to a subdirectory of itself, '${s}'.`);
    if (St.isSrcSubdir(s, r))
      throw new Error(`Cannot overwrite '${s}' with '${r}'.`);
    return vs(r, n);
  } else
    return j.symlinkSync(r, n);
}
function vs(e, t) {
  return j.unlinkSync(t), j.symlinkSync(e, t);
}
var Ps = fs;
const Rs = O.fromPromise;
var pe = {
  copy: Rs(cs),
  copySync: Ps
};
const Tn = dt, bs = O.fromCallback;
function Ts(e, t) {
  Tn.rm(e, { recursive: !0, force: !0 }, t);
}
function Fs(e) {
  Tn.rmSync(e, { recursive: !0, force: !0 });
}
var Wt = {
  remove: bs(Ts),
  removeSync: Fs
};
const Ds = O.fromPromise, Fn = Y, Dn = F, kn = X, In = Wt, Ue = Ds(async function(t) {
  let n;
  try {
    n = await Fn.readdir(t);
  } catch {
    return kn.mkdirs(t);
  }
  return Promise.all(n.map((i) => In.remove(Dn.join(t, i))));
});
function Ye(e) {
  let t;
  try {
    t = Fn.readdirSync(e);
  } catch {
    return kn.mkdirsSync(e);
  }
  t.forEach((n) => {
    n = Dn.join(e, n), In.removeSync(n);
  });
}
var ks = {
  emptyDirSync: Ye,
  emptydirSync: Ye,
  emptyDir: Ue,
  emptydir: Ue
};
const Is = O.fromPromise, On = F, q = Y, Nn = X;
async function Os(e) {
  let t;
  try {
    t = await q.stat(e);
  } catch {
  }
  if (t && t.isFile()) return;
  const n = On.dirname(e);
  let i = null;
  try {
    i = await q.stat(n);
  } catch (r) {
    if (r.code === "ENOENT") {
      await Nn.mkdirs(n), await q.writeFile(e, "");
      return;
    } else
      throw r;
  }
  i.isDirectory() ? await q.writeFile(e, "") : await q.readdir(n);
}
function Ns(e) {
  let t;
  try {
    t = q.statSync(e);
  } catch {
  }
  if (t && t.isFile()) return;
  const n = On.dirname(e);
  try {
    q.statSync(n).isDirectory() || q.readdirSync(n);
  } catch (i) {
    if (i && i.code === "ENOENT") Nn.mkdirsSync(n);
    else throw i;
  }
  q.writeFileSync(e, "");
}
var $s = {
  createFile: Is(Os),
  createFileSync: Ns
};
const Cs = O.fromPromise, $n = F, tt = Y, Cn = X, { pathExists: Ls } = ot, { areIdentical: Ln } = ht;
async function As(e, t) {
  let n;
  try {
    n = await tt.lstat(t);
  } catch {
  }
  let i;
  try {
    i = await tt.lstat(e);
  } catch (o) {
    throw o.message = o.message.replace("lstat", "ensureLink"), o;
  }
  if (n && Ln(i, n)) return;
  const r = $n.dirname(t);
  await Ls(r) || await Cn.mkdirs(r), await tt.link(e, t);
}
function xs(e, t) {
  let n;
  try {
    n = tt.lstatSync(t);
  } catch {
  }
  try {
    const s = tt.lstatSync(e);
    if (n && Ln(s, n)) return;
  } catch (s) {
    throw s.message = s.message.replace("lstat", "ensureLink"), s;
  }
  const i = $n.dirname(t);
  return tt.existsSync(i) || Cn.mkdirsSync(i), tt.linkSync(e, t);
}
var Ms = {
  createLink: Cs(As),
  createLinkSync: xs
};
const et = F, wt = Y, { pathExists: Ws } = ot, js = O.fromPromise;
async function Us(e, t) {
  if (et.isAbsolute(e)) {
    try {
      await wt.lstat(e);
    } catch (s) {
      throw s.message = s.message.replace("lstat", "ensureSymlink"), s;
    }
    return {
      toCwd: e,
      toDst: e
    };
  }
  const n = et.dirname(t), i = et.join(n, e);
  if (await Ws(i))
    return {
      toCwd: i,
      toDst: e
    };
  try {
    await wt.lstat(e);
  } catch (s) {
    throw s.message = s.message.replace("lstat", "ensureSymlink"), s;
  }
  return {
    toCwd: e,
    toDst: et.relative(n, e)
  };
}
function Ys(e, t) {
  if (et.isAbsolute(e)) {
    if (!wt.existsSync(e)) throw new Error("absolute srcpath does not exist");
    return {
      toCwd: e,
      toDst: e
    };
  }
  const n = et.dirname(t), i = et.join(n, e);
  if (wt.existsSync(i))
    return {
      toCwd: i,
      toDst: e
    };
  if (!wt.existsSync(e)) throw new Error("relative srcpath does not exist");
  return {
    toCwd: e,
    toDst: et.relative(n, e)
  };
}
var Hs = {
  symlinkPaths: js(Us),
  symlinkPathsSync: Ys
};
const An = Y, zs = O.fromPromise;
async function Bs(e, t) {
  if (t) return t;
  let n;
  try {
    n = await An.lstat(e);
  } catch {
    return "file";
  }
  return n && n.isDirectory() ? "dir" : "file";
}
function Gs(e, t) {
  if (t) return t;
  let n;
  try {
    n = An.lstatSync(e);
  } catch {
    return "file";
  }
  return n && n.isDirectory() ? "dir" : "file";
}
var Ks = {
  symlinkType: zs(Bs),
  symlinkTypeSync: Gs
};
const Vs = O.fromPromise, xn = F, J = Y, { mkdirs: Js, mkdirsSync: Xs } = X, { symlinkPaths: qs, symlinkPathsSync: Qs } = Hs, { symlinkType: Zs, symlinkTypeSync: to } = Ks, { pathExists: eo } = ot, { areIdentical: Mn } = ht;
async function no(e, t, n) {
  let i;
  try {
    i = await J.lstat(t);
  } catch {
  }
  if (i && i.isSymbolicLink()) {
    const [a, l] = await Promise.all([
      J.stat(e),
      J.stat(t)
    ]);
    if (Mn(a, l)) return;
  }
  const r = await qs(e, t);
  e = r.toDst;
  const s = await Zs(r.toCwd, n), o = xn.dirname(t);
  return await eo(o) || await Js(o), J.symlink(e, t, s);
}
function ro(e, t, n) {
  let i;
  try {
    i = J.lstatSync(t);
  } catch {
  }
  if (i && i.isSymbolicLink()) {
    const a = J.statSync(e), l = J.statSync(t);
    if (Mn(a, l)) return;
  }
  const r = Qs(e, t);
  e = r.toDst, n = to(r.toCwd, n);
  const s = xn.dirname(t);
  return J.existsSync(s) || Xs(s), J.symlinkSync(e, t, n);
}
var io = {
  createSymlink: Vs(no),
  createSymlinkSync: ro
};
const { createFile: He, createFileSync: ze } = $s, { createLink: Be, createLinkSync: Ge } = Ms, { createSymlink: Ke, createSymlinkSync: Ve } = io;
var so = {
  // file
  createFile: He,
  createFileSync: ze,
  ensureFile: He,
  ensureFileSync: ze,
  // link
  createLink: Be,
  createLinkSync: Ge,
  ensureLink: Be,
  ensureLinkSync: Ge,
  // symlink
  createSymlink: Ke,
  createSymlinkSync: Ve,
  ensureSymlink: Ke,
  ensureSymlinkSync: Ve
};
function oo(e, { EOL: t = `
`, finalEOL: n = !0, replacer: i = null, spaces: r } = {}) {
  const s = n ? t : "";
  return JSON.stringify(e, i, r).replace(/\n/g, t) + s;
}
function ao(e) {
  return Buffer.isBuffer(e) && (e = e.toString("utf8")), e.replace(/^\uFEFF/, "");
}
var ye = { stringify: oo, stripBom: ao };
let ft;
try {
  ft = dt;
} catch {
  ft = Ze;
}
const jt = O, { stringify: Wn, stripBom: jn } = ye;
async function co(e, t = {}) {
  typeof t == "string" && (t = { encoding: t });
  const n = t.fs || ft, i = "throws" in t ? t.throws : !0;
  let r = await jt.fromCallback(n.readFile)(e, t);
  r = jn(r);
  let s;
  try {
    s = JSON.parse(r, t ? t.reviver : null);
  } catch (o) {
    if (i)
      throw o.message = `${e}: ${o.message}`, o;
    return null;
  }
  return s;
}
const lo = jt.fromPromise(co);
function uo(e, t = {}) {
  typeof t == "string" && (t = { encoding: t });
  const n = t.fs || ft, i = "throws" in t ? t.throws : !0;
  try {
    let r = n.readFileSync(e, t);
    return r = jn(r), JSON.parse(r, t.reviver);
  } catch (r) {
    if (i)
      throw r.message = `${e}: ${r.message}`, r;
    return null;
  }
}
async function fo(e, t, n = {}) {
  const i = n.fs || ft, r = Wn(t, n);
  await jt.fromCallback(i.writeFile)(e, r, n);
}
const ho = jt.fromPromise(fo);
function mo(e, t, n = {}) {
  const i = n.fs || ft, r = Wn(t, n);
  return i.writeFileSync(e, r, n);
}
var po = {
  readFile: lo,
  readFileSync: uo,
  writeFile: ho,
  writeFileSync: mo
};
const Tt = po;
var yo = {
  // jsonfile exports
  readJson: Tt.readFile,
  readJsonSync: Tt.readFileSync,
  writeJson: Tt.writeFile,
  writeJsonSync: Tt.writeFileSync
};
const wo = O.fromPromise, ee = Y, Un = F, Yn = X, Eo = ot.pathExists;
async function _o(e, t, n = "utf-8") {
  const i = Un.dirname(e);
  return await Eo(i) || await Yn.mkdirs(i), ee.writeFile(e, t, n);
}
function go(e, ...t) {
  const n = Un.dirname(e);
  ee.existsSync(n) || Yn.mkdirsSync(n), ee.writeFileSync(e, ...t);
}
var we = {
  outputFile: wo(_o),
  outputFileSync: go
};
const { stringify: So } = ye, { outputFile: vo } = we;
async function Po(e, t, n = {}) {
  const i = So(t, n);
  await vo(e, i, n);
}
var Ro = Po;
const { stringify: bo } = ye, { outputFileSync: To } = we;
function Fo(e, t, n) {
  const i = bo(t, n);
  To(e, i, n);
}
var Do = Fo;
const ko = O.fromPromise, U = yo;
U.outputJson = ko(Ro);
U.outputJsonSync = Do;
U.outputJSON = U.outputJson;
U.outputJSONSync = U.outputJsonSync;
U.writeJSON = U.writeJson;
U.writeJSONSync = U.writeJsonSync;
U.readJSON = U.readJson;
U.readJSONSync = U.readJsonSync;
var Io = U;
const Oo = Y, Je = F, { copy: No } = pe, { remove: Hn } = Wt, { mkdirp: $o } = X, { pathExists: Co } = ot, Xe = ht;
async function Lo(e, t, n = {}) {
  const i = n.overwrite || n.clobber || !1, { srcStat: r, isChangingCase: s = !1 } = await Xe.checkPaths(e, t, "move", n);
  await Xe.checkParentPaths(e, r, t, "move");
  const o = Je.dirname(t);
  return Je.parse(o).root !== o && await $o(o), Ao(e, t, i, s);
}
async function Ao(e, t, n, i) {
  if (!i) {
    if (n)
      await Hn(t);
    else if (await Co(t))
      throw new Error("dest already exists.");
  }
  try {
    await Oo.rename(e, t);
  } catch (r) {
    if (r.code !== "EXDEV")
      throw r;
    await xo(e, t, n);
  }
}
async function xo(e, t, n) {
  return await No(e, t, {
    overwrite: n,
    errorOnExist: !0,
    preserveTimestamps: !0
  }), Hn(e);
}
var Mo = Lo;
const zn = dt, ne = F, Wo = pe.copySync, Bn = Wt.removeSync, jo = X.mkdirpSync, qe = ht;
function Uo(e, t, n) {
  n = n || {};
  const i = n.overwrite || n.clobber || !1, { srcStat: r, isChangingCase: s = !1 } = qe.checkPathsSync(e, t, "move", n);
  return qe.checkParentPathsSync(e, r, t, "move"), Yo(t) || jo(ne.dirname(t)), Ho(e, t, i, s);
}
function Yo(e) {
  const t = ne.dirname(e);
  return ne.parse(t).root === t;
}
function Ho(e, t, n, i) {
  if (i) return Xt(e, t, n);
  if (n)
    return Bn(t), Xt(e, t, n);
  if (zn.existsSync(t)) throw new Error("dest already exists.");
  return Xt(e, t, n);
}
function Xt(e, t, n) {
  try {
    zn.renameSync(e, t);
  } catch (i) {
    if (i.code !== "EXDEV") throw i;
    return zo(e, t, n);
  }
}
function zo(e, t, n) {
  return Wo(e, t, {
    overwrite: n,
    errorOnExist: !0,
    preserveTimestamps: !0
  }), Bn(e);
}
var Bo = Uo;
const Go = O.fromPromise;
var Ko = {
  move: Go(Mo),
  moveSync: Bo
}, Vo = {
  // Export promiseified graceful-fs:
  ...Y,
  // Export extra methods:
  ...pe,
  ...ks,
  ...so,
  ...Io,
  ...X,
  ...Ko,
  ...we,
  ...ot,
  ...Wt
};
const rt = /* @__PURE__ */ Pi(Vo);
Te ? At.setFfmpegPath(Te.replace("app.asar", "app.asar.unpacked")) : console.error("ffmpeg-static not found");
zt && zt.path ? At.setFfprobePath(zt.path.replace("app.asar", "app.asar.unpacked")) : console.error("ffprobe-static not found");
async function Ee(e) {
  try {
    const t = await Jo(e.file_path), n = await Xo(e.file_path, e.id, t.duration);
    return {
      ...e,
      // Keep parsed title and year from filename
      title: e.title,
      original_title: e.title,
      year: e.year,
      plot: t.duration ? `Duration: ${qo(t.duration)}` : null,
      poster_path: n,
      // Path to generated thumbnail
      backdrop_path: null,
      rating: null
    };
  } catch (t) {
    return console.error("Error extracting metadata:", t), e;
  }
}
async function Jo(e) {
  return new Promise((t, n) => {
    At.ffprobe(e, (i, r) => {
      if (i) {
        n(i);
        return;
      }
      const s = r.streams.find((o) => o.codec_type === "video");
      t({
        duration: typeof r.format.duration == "number" ? r.format.duration : parseFloat(r.format.duration || "0"),
        width: s == null ? void 0 : s.width,
        height: s == null ? void 0 : s.height,
        codec: s == null ? void 0 : s.codec_name,
        size: r.format.size
      });
    });
  });
}
async function Xo(e, t, n) {
  try {
    const i = F.join(G.getPath("userData"), "thumbnails");
    await rt.ensureDir(i);
    const r = F.join(i, `${t}.jpg`);
    if (await rt.pathExists(r))
      return r;
    let s = 10;
    return typeof n == "number" && !isNaN(n) && n > 0 && (s = n * 0.1), new Promise((o, a) => {
      At(e).screenshots({
        timestamps: [s],
        filename: `${t}.jpg`,
        folder: i,
        size: "640x?"
        // Maintain aspect ratio, width 640px
      }).on("end", () => {
        console.log(`Thumbnail generated for movie ${t}`), o(r);
      }).on("error", (l) => {
        console.error(`Failed to generate thumbnail for movie ${t}:`, l), o(null);
      });
    });
  } catch (i) {
    return console.error("Thumbnail generation error:", i), null;
  }
}
function qo(e) {
  const t = Math.floor(e / 3600), n = Math.floor(e % 3600 / 60);
  return t > 0 ? `${t}h ${n}m` : `${n}m`;
}
const Qo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  fetchMetadata: Ee
}, Symbol.toStringTag, { value: "Module" }));
function Ut() {
  var a;
  const e = $t(), t = qt(), n = new Map(t.map((l) => [l.name, l.id])), i = new Set(Nr()), r = /* @__PURE__ */ new Map();
  for (const l of e) {
    const f = F.dirname(l.file_path), c = F.basename(f);
    r.has(c) || r.set(c, []), (a = r.get(c)) == null || a.push(l);
  }
  let s = 0, o = 0;
  for (const [l, f] of r) {
    if (f.length < 2) continue;
    if (i.has(l)) {
      console.log(`Skipping deleted folder playlist: ${l}`);
      continue;
    }
    let c = n.get(l);
    if (!c) {
      nn(l);
      const u = qt().find((d) => d.name === l);
      u && (c = u.id, n.set(l, c), s++);
    }
    if (c)
      for (const u of f)
        sn(c, u.id), o++;
  }
  return rn(), { created: s, added: o };
}
const Zo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  generateDefaultPlaylists: Ut
}, Symbol.toStringTag, { value: "Module" }));
let Ft = null;
const Gn = [".mkv", ".mp4", ".avi", ".mov", ".wmv"];
function Kn() {
  const e = ae().map((t) => t.path);
  e.length !== 0 && (Ft && Ft.close(), Ft = vi(e, {
    ignored: /(^|[\/\\])\../,
    // ignore dotfiles
    persistent: !0,
    depth: 5,
    ignoreInitial: !0
    // We handle initial sync manually
  }), Ft.on("add", (t) => {
    const n = F.extname(t).toLowerCase();
    Gn.includes(n) && Vn(t);
  }).on("unlink", (t) => {
    Jn(t);
  }), ta());
}
function ta() {
  console.log("Watcher: Syncing library...");
  const e = $t(), t = ae().map((o) => o.path);
  let n = 0;
  e.forEach((o) => {
    rt.existsSync(o.file_path) || (console.log("Watcher: Found missing file during sync:", o.file_path), Jn(o.file_path), n++);
  });
  let i = 0;
  const r = (o) => {
    try {
      if (!rt.existsSync(o)) return;
      const a = rt.readdirSync(o);
      for (const l of a) {
        const f = F.join(o, l);
        if (rt.statSync(f).isDirectory())
          r(f);
        else {
          const u = F.extname(f).toLowerCase();
          Gn.includes(u) && (tn(f) || (console.log("Watcher: Found new file during sync:", f), Vn(f), i++));
        }
      }
    } catch (a) {
      console.error("Watcher: Error scanning directory:", o, a);
    }
  };
  t.forEach((o) => r(o));
  let s = 0;
  e.forEach((o) => {
    const a = o.poster_path && rt.existsSync(o.poster_path), l = o.poster_path && o.poster_path.endsWith("undefined.jpg");
    (!a || l) && (console.log("Watcher: Missing or invalid thumbnail for:", o.title, "ID:", o.id), s++, Ee(o).then((f) => {
      f && f.poster_path && (ce(o.id, f), nt("library-updated"));
    }).catch((f) => console.error("Watcher: Failed to generate thumbnail for", o.title, f)));
  }), i > 0 || n > 0 || s > 0 ? (console.log(`Watcher: Sync complete. Removed ${n}, Added ${i}, Generating thumbnails for ${s}.`), Ut(), nt("library-updated"), nt("playlists-updated")) : console.log("Watcher: Sync complete. No changes.");
}
function ea() {
  Kn();
}
function Vn(e) {
  if (console.log("Watcher: File add event detected for:", e), tn(e)) {
    console.log("Watcher: File already exists in DB, skipping:", e);
    return;
  }
  const t = F.basename(e), n = na(t), i = {
    title: n.title,
    original_title: n.title,
    // Placeholder
    year: n.year,
    plot: "",
    poster_path: "",
    backdrop_path: "",
    rating: 0,
    file_path: e
  };
  try {
    const r = en(i);
    nt("library-updated");
    const s = { ...i, id: r.lastInsertRowid };
    Ee(s).then((o) => {
      o && (ce(r.lastInsertRowid, o), nt("library-updated"));
    }).catch((o) => console.error("Metadata fetch failed:", o)), Ut(), nt("playlists-updated");
  } catch (r) {
    console.error("Failed to add movie:", r);
  }
}
function Jn(e) {
  console.log("Watcher: File remove event detected for:", e);
  try {
    const t = br(e);
    console.log("Watcher: Database removal result:", t), rn(), nt("library-updated"), nt("playlists-updated");
  } catch (t) {
    console.error("Watcher: Failed to remove movie:", t);
  }
}
function na(e) {
  const t = e.replace(/\.[^/.]+$/, ""), n = t.match(/(19|20)\d{2}/);
  let i = n ? parseInt(n[0]) : void 0, r = t;
  return n && (r = t.substring(0, n.index).trim()), r = r.replace(/[._]/g, " ").trim(), { title: r, year: i };
}
function nt(e, t) {
  ie.getAllWindows().forEach((i) => i.webContents.send(e, t));
}
function ra() {
  k.handle("db:get-library", () => $t()), k.handle("db:add-movie", (e, t) => en(t)), k.handle("db:get-watch-paths", () => ae()), k.handle("db:add-watch-path", (e, t) => Sr(t)), k.handle("db:remove-watch-path", (e, t) => {
    const n = Fr(t);
    return n && (Tr(n.path), console.log(`Removed movies from watch path: ${n.path}`)), vr(t);
  }), k.handle("settings:get", (e, t) => Pr(t)), k.handle("settings:set", (e, t, n) => Rr(t, n)), k.handle("db:create-playlist", (e, t) => (Or(t), nn(t))), k.handle("db:get-playlists", () => qt()), k.handle("db:delete-playlist", (e, t) => {
    const n = Dr(t);
    return n && (Ir(n.name), console.log(`Playlist "${n.name}" marked as deleted (won't auto-regenerate)`)), kr(t);
  }), k.handle("db:add-movie-to-playlist", (e, t, n) => sn(t, n)), k.handle("db:remove-movie-from-playlist", (e, t, n) => $r(t, n)), k.handle("db:get-playlist-movies", (e, t) => Cr(t)), k.handle("db:update-playback-progress", (e, t, n) => Lr(t, n)), k.handle("db:get-playback-progress", (e, t) => Ar(t)), k.handle("db:generate-default-playlists", async () => {
    const { generateDefaultPlaylists: e } = await Promise.resolve().then(() => Zo);
    return e();
  }), k.handle("dialog:open-directory", async () => {
    const e = await se.showOpenDialog({
      properties: ["openDirectory"]
    });
    return e.canceled ? null : e.filePaths[0];
  }), k.handle("watcher:update", () => {
    ea();
  }), k.handle("thumbnails:regenerate", async () => {
    const { fetchMetadata: e } = await Promise.resolve().then(() => Qo), t = $t();
    console.log(`Regenerating thumbnails for ${t.length} movies...`);
    let n = 0;
    for (const i of t)
      try {
        const r = await e(i);
        r && r.poster_path && (ce(i.id, r), n++);
      } catch (r) {
        console.error(`Failed to generate thumbnail for ${i.title}:`, r);
      }
    return console.log(`Generated ${n} thumbnails`), { total: t.length, success: n };
  }), k.handle("media:get-metadata", async (e, t) => {
    const { getMediaMetadata: n } = await import("./ffmpeg-BDWm5NZf.js");
    return n(t);
  }), k.handle("media:extract-subtitle", async (e, t, n) => {
    const { extractSubtitle: i } = await import("./ffmpeg-BDWm5NZf.js");
    return i(t, n);
  }), k.handle("media:extract-subtitle-content", async (e, t, n) => {
    const { extractSubtitleContent: i } = await import("./ffmpeg-BDWm5NZf.js");
    return i(t, n);
  });
}
const _e = V.dirname(Zn(import.meta.url));
process.env.APP_ROOT = V.join(_e, "..");
const re = process.env.VITE_DEV_SERVER_URL, Ra = V.join(process.env.APP_ROOT, "dist-electron"), Xn = V.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = re ? V.join(process.env.APP_ROOT, "public") : Xn;
const ge = G.isPackaged ? V.join(G.getPath("userData"), "kino-debug.log") : V.join(_e, "..", "kino-debug.log");
function z(e, t, n) {
  const r = `[${(/* @__PURE__ */ new Date()).toISOString()}] [${e}] ${t}${n ? `
${n.stack}` : ""}
`;
  try {
    Dt.appendFileSync(ge, r);
  } catch {
    console.log(r);
  }
  G.isPackaged || console.log(r);
}
process.on("uncaughtException", (e) => {
  z("ERROR", "Uncaught Exception:", e), se.showErrorBox("Kino - Fatal Error", `An unexpected error occurred:

${e.message}

Check logs at: ${ge}`), G.quit();
});
process.on("unhandledRejection", (e, t) => {
  z("ERROR", `Unhandled Rejection at: ${t}, reason: ${e}`);
});
Qe.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      secure: !0,
      supportFetchAPI: !0,
      bypassCSP: !0,
      stream: !0
    }
  }
]);
G.commandLine.appendSwitch("enable-experimental-web-platform-features");
let Z;
function qn() {
  Z = new ie({
    icon: V.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: V.join(_e, "preload.mjs")
    }
  }), Z.webContents.on("did-finish-load", () => {
    Z == null || Z.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), re ? Z.loadURL(re) : Z.loadFile(V.join(Xn, "index.html"));
}
G.on("window-all-closed", () => {
  process.platform !== "darwin" && (G.quit(), Z = null);
});
G.on("activate", () => {
  ie.getAllWindows().length === 0 && qn();
});
G.whenReady().then(async () => {
  z("INFO", "App ready, starting initialization...");
  try {
    Qe.handle("media", async (e) => {
      const t = e.url.replace("media://", ""), n = decodeURIComponent(t);
      console.log("Media request:", { url: t, filePath: n });
      try {
        const r = (await Dt.promises.stat(n)).size, s = e.headers.get("Range"), a = ((l) => {
          switch (V.extname(l).toLowerCase()) {
            case ".mp4":
              return "video/mp4";
            case ".mkv":
              return "video/x-matroska";
            case ".webm":
              return "video/webm";
            case ".avi":
              return "video/x-msvideo";
            case ".mov":
              return "video/quicktime";
            case ".vtt":
              return "text/vtt";
            default:
              return "application/octet-stream";
          }
        })(n);
        if (s) {
          const l = s.replace(/bytes=/, "").split("-"), f = parseInt(l[0], 10), c = l[1] ? parseInt(l[1], 10) : r - 1, u = c - f + 1, d = Dt.createReadStream(n, { start: f, end: c });
          return new Response(d, {
            status: 206,
            headers: {
              "Content-Range": `bytes ${f}-${c}/${r}`,
              "Accept-Ranges": "bytes",
              "Content-Length": u.toString(),
              "Content-Type": a
            }
          });
        } else {
          const l = Dt.createReadStream(n);
          return new Response(l, {
            status: 200,
            headers: {
              "Content-Length": r.toString(),
              "Content-Type": a
            }
          });
        }
      } catch (i) {
        return console.error("Error serving media:", i), new Response("Not Found", { status: 404 });
      }
    }), z("INFO", "Media protocol handler registered");
    try {
      gr(), z("INFO", "Database initialized successfully");
    } catch (e) {
      throw z("ERROR", "Database initialization failed:", e), e;
    }
    try {
      ra(), z("INFO", "IPC handlers registered");
    } catch (e) {
      throw z("ERROR", "IPC registration failed:", e), e;
    }
    try {
      Kn(), z("INFO", "File watcher started");
    } catch (e) {
      z("ERROR", "Watcher start failed:", e);
    }
    try {
      Ut(), z("INFO", "Default playlists generated");
    } catch (e) {
      z("ERROR", "Playlist generation failed:", e);
    }
    qn(), z("INFO", "Main window created");
  } catch (e) {
    z("ERROR", "Fatal error during app initialization:", e), se.showErrorBox("Kino - Startup Error", `Failed to start Kino:

${e.message}

Check logs at: ${ge}`), G.quit();
  }
});
export {
  Ra as MAIN_DIST,
  Xn as RENDERER_DIST,
  re as VITE_DEV_SERVER_URL
};

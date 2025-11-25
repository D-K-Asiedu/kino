import { app as it, BrowserWindow as ne, ipcMain as F, dialog as Kn, protocol as Be } from "electron";
import { fileURLToPath as Jn } from "node:url";
import J, { resolve as Ee, join as Xn, relative as qn, sep as Qn } from "node:path";
import jt from "node:fs";
import Zn from "better-sqlite3";
import * as y from "path";
import k from "path";
import Ve, { unwatchFile as _e, watchFile as tr, watch as er, stat as nr } from "fs";
import { realpath as Ut, stat as re, lstat as rr, open as ir, readdir as sr } from "fs/promises";
import { EventEmitter as or } from "events";
import { lstat as ge, stat as ar, readdir as cr, realpath as lr } from "node:fs/promises";
import { Readable as ur } from "node:stream";
import { type as fr } from "os";
import hr from "constants";
import dr from "stream";
import mr from "util";
import yr from "assert";
import $t from "fluent-ffmpeg";
import Se from "ffmpeg-static";
import Yt from "ffprobe-static";
const pr = k.join(it.getPath("userData"), "kino.db"), I = new Zn(pr);
I.pragma("foreign_keys = ON");
function wr() {
  I.exec(`
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
  `);
}
function It() {
  return I.prepare("SELECT * FROM movies ORDER BY added_at DESC").all();
}
function Ke(e) {
  return !!I.prepare("SELECT 1 FROM movies WHERE file_path = ?").get(e);
}
function Je(e) {
  return I.prepare(`
    INSERT OR IGNORE INTO movies (title, original_title, year, plot, poster_path, backdrop_path, rating, file_path)
    VALUES (@title, @original_title, @year, @plot, @poster_path, @backdrop_path, @rating, @file_path)
  `).run(e);
}
function ie() {
  return I.prepare("SELECT * FROM watch_paths").all();
}
function Er(e) {
  return I.prepare("INSERT OR IGNORE INTO watch_paths (path) VALUES (?)").run(e);
}
function _r(e) {
  return I.prepare("DELETE FROM watch_paths WHERE id = ?").run(e);
}
function gr(e) {
  const t = I.prepare("SELECT value FROM settings WHERE key = ?").get(e);
  return t ? t.value : null;
}
function Sr(e, t) {
  return I.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(e, t);
}
function se(e, t) {
  return I.prepare(`
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
function vr(e) {
  console.log("Database: Attempting to remove movie with path:", e);
  const t = I.prepare("DELETE FROM movies WHERE file_path = ?").run(e);
  return console.log("Database: Removal result:", t), t;
}
function Xe(e) {
  return I.prepare("INSERT INTO playlists (name) VALUES (?)").run(e);
}
function Jt() {
  return I.prepare("SELECT * FROM playlists ORDER BY created_at DESC").all();
}
function Pr(e) {
  return I.prepare("DELETE FROM playlists WHERE id = ?").run(e);
}
function qe() {
  const e = I.prepare(`
    DELETE FROM playlists 
    WHERE id NOT IN (SELECT DISTINCT playlist_id FROM playlist_movies)
  `).run();
  return e.changes > 0 && console.log(`Database: Deleted ${e.changes} empty playlists`), e;
}
function Qe(e, t) {
  return I.prepare("INSERT OR IGNORE INTO playlist_movies (playlist_id, movie_id) VALUES (?, ?)").run(e, t);
}
function br(e, t) {
  return I.prepare("DELETE FROM playlist_movies WHERE playlist_id = ? AND movie_id = ?").run(e, t);
}
function Tr(e) {
  return I.prepare(`
    SELECT m.*, pm.added_at as playlist_added_at
    FROM movies m
    JOIN playlist_movies pm ON m.id = pm.movie_id
    WHERE pm.playlist_id = ?
    ORDER BY pm.added_at DESC
  `).all(e);
}
function Rr(e, t) {
  return I.prepare(`
    INSERT OR REPLACE INTO playback_progress (movie_id, progress, last_watched)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(e, t);
}
function Fr(e) {
  const t = I.prepare("SELECT progress FROM playback_progress WHERE movie_id = ?").get(e);
  return t ? t.progress : 0;
}
const z = {
  FILE_TYPE: "files",
  DIR_TYPE: "directories",
  FILE_DIR_TYPE: "files_directories",
  EVERYTHING_TYPE: "all"
}, Xt = {
  root: ".",
  fileFilter: (e) => !0,
  directoryFilter: (e) => !0,
  type: z.FILE_TYPE,
  lstat: !1,
  depth: 2147483648,
  alwaysStat: !1,
  highWaterMark: 4096
};
Object.freeze(Xt);
const Ze = "READDIRP_RECURSIVE_ERROR", Dr = /* @__PURE__ */ new Set(["ENOENT", "EPERM", "EACCES", "ELOOP", Ze]), ve = [
  z.DIR_TYPE,
  z.EVERYTHING_TYPE,
  z.FILE_DIR_TYPE,
  z.FILE_TYPE
], kr = /* @__PURE__ */ new Set([
  z.DIR_TYPE,
  z.EVERYTHING_TYPE,
  z.FILE_DIR_TYPE
]), Ir = /* @__PURE__ */ new Set([
  z.EVERYTHING_TYPE,
  z.FILE_DIR_TYPE,
  z.FILE_TYPE
]), Or = (e) => Dr.has(e.code), Nr = process.platform === "win32", Pe = (e) => !0, be = (e) => {
  if (e === void 0)
    return Pe;
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
  return Pe;
};
class $r extends ur {
  constructor(t = {}) {
    super({
      objectMode: !0,
      autoDestroy: !0,
      highWaterMark: t.highWaterMark
    });
    const n = { ...Xt, ...t }, { root: i, type: r } = n;
    this._fileFilter = be(n.fileFilter), this._directoryFilter = be(n.directoryFilter);
    const s = n.lstat ? ge : ar;
    Nr ? this._stat = (o) => s(o, { bigint: !0 }) : this._stat = s, this._maxDepth = n.depth ?? Xt.depth, this._wantsDir = r ? kr.has(r) : !1, this._wantsFile = r ? Ir.has(r) : !1, this._wantsEverything = r === z.EVERYTHING_TYPE, this._root = Ee(i), this._isDirent = !n.alwaysStat, this._statsProp = this._isDirent ? "dirent" : "stats", this._rdOptions = { encoding: "utf8", withFileTypes: this._isDirent }, this.parents = [this._exploreDir(i, 1)], this.reading = !1, this.parent = void 0;
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
              const u = await this._getEntryType(l);
              u === "directory" && this._directoryFilter(l) ? (s <= this._maxDepth && this.parents.push(this._exploreDir(l.fullPath, s + 1)), this._wantsDir && (this.push(l), t--)) : (u === "file" || this._includeAsFile(l)) && this._fileFilter(l) && this._wantsFile && (this.push(l), t--);
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
      i = await cr(t, this._rdOptions);
    } catch (r) {
      this._onError(r);
    }
    return { files: i, depth: n, path: t };
  }
  async _formatEntry(t, n) {
    let i;
    const r = this._isDirent ? t.name : t;
    try {
      const s = Ee(Xn(n, r));
      i = { path: qn(this._root, s), fullPath: s, basename: r }, i[this._statsProp] = this._isDirent ? t : await this._stat(s);
    } catch (s) {
      this._onError(s);
      return;
    }
    return i;
  }
  _onError(t) {
    Or(t) && !this.destroyed ? this.emit("warn", t) : this.destroy(t);
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
        const r = await lr(i), s = await ge(r);
        if (s.isFile())
          return "file";
        if (s.isDirectory()) {
          const o = r.length;
          if (i.startsWith(r) && i.substr(o, 1) === Qn) {
            const a = new Error(`Circular symlink detected: "${i}" points to "${r}"`);
            return a.code = Ze, this._onError(a);
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
function Cr(e, t = {}) {
  let n = t.entryType || t.type;
  if (n === "both" && (n = z.FILE_DIR_TYPE), n && (t.type = n), e) {
    if (typeof e != "string")
      throw new TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
    if (n && !ve.includes(n))
      throw new Error(`readdirp: Invalid type passed. Use one of ${ve.join(", ")}`);
  } else throw new Error("readdirp: root argument is required. Usage: readdirp(root, options)");
  return t.root = e, new $r(t);
}
const Lr = "data", tn = "end", Ar = "close", oe = () => {
}, Ct = process.platform, en = Ct === "win32", xr = Ct === "darwin", Mr = Ct === "linux", Wr = Ct === "freebsd", jr = fr() === "OS400", D = {
  ALL: "all",
  READY: "ready",
  ADD: "add",
  CHANGE: "change",
  ADD_DIR: "addDir",
  UNLINK: "unlink",
  UNLINK_DIR: "unlinkDir",
  RAW: "raw",
  ERROR: "error"
}, G = D, Ur = "watch", Yr = { lstat: rr, stat: re }, nt = "listeners", Rt = "errHandlers", at = "rawEmitters", Hr = [nt, Rt, at], zr = /* @__PURE__ */ new Set([
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
]), Gr = (e) => zr.has(y.extname(e).slice(1).toLowerCase()), qt = (e, t) => {
  e instanceof Set ? e.forEach(t) : t(e);
}, mt = (e, t, n) => {
  let i = e[t];
  i instanceof Set || (e[t] = i = /* @__PURE__ */ new Set([i])), i.add(n);
}, Br = (e) => (t) => {
  const n = e[t];
  n instanceof Set ? n.clear() : delete e[t];
}, yt = (e, t, n) => {
  const i = e[t];
  i instanceof Set ? i.delete(n) : i === n && delete e[t];
}, nn = (e) => e instanceof Set ? e.size === 0 : !e, Ft = /* @__PURE__ */ new Map();
function Te(e, t, n, i, r) {
  const s = (o, a) => {
    n(e), r(o, a, { watchedPath: e }), a && e !== a && Dt(y.resolve(e, a), nt, y.join(e, a));
  };
  try {
    return er(e, {
      persistent: t.persistent
    }, s);
  } catch (o) {
    i(o);
    return;
  }
}
const Dt = (e, t, n, i, r) => {
  const s = Ft.get(e);
  s && qt(s[t], (o) => {
    o(n, i, r);
  });
}, Vr = (e, t, n, i) => {
  const { listener: r, errHandler: s, rawEmitter: o } = i;
  let a = Ft.get(t), l;
  if (!n.persistent)
    return l = Te(e, n, r, s, o), l ? l.close.bind(l) : void 0;
  if (a)
    mt(a, nt, r), mt(a, Rt, s), mt(a, at, o);
  else {
    if (l = Te(
      e,
      n,
      Dt.bind(null, t, nt),
      s,
      // no need to use broadcast here
      Dt.bind(null, t, at)
    ), !l)
      return;
    l.on(G.ERROR, async (u) => {
      const c = Dt.bind(null, t, Rt);
      if (a && (a.watcherUnusable = !0), en && u.code === "EPERM")
        try {
          await (await ir(e, "r")).close(), c(u);
        } catch {
        }
      else
        c(u);
    }), a = {
      listeners: r,
      errHandlers: s,
      rawEmitters: o,
      watcher: l
    }, Ft.set(t, a);
  }
  return () => {
    yt(a, nt, r), yt(a, Rt, s), yt(a, at, o), nn(a.listeners) && (a.watcher.close(), Ft.delete(t), Hr.forEach(Br(a)), a.watcher = void 0, Object.freeze(a));
  };
}, Ht = /* @__PURE__ */ new Map(), Kr = (e, t, n, i) => {
  const { listener: r, rawEmitter: s } = i;
  let o = Ht.get(t);
  const a = o && o.options;
  return a && (a.persistent < n.persistent || a.interval > n.interval) && (_e(t), o = void 0), o ? (mt(o, nt, r), mt(o, at, s)) : (o = {
    listeners: r,
    rawEmitters: s,
    options: n,
    watcher: tr(t, n, (l, u) => {
      qt(o.rawEmitters, (f) => {
        f(G.CHANGE, t, { curr: l, prev: u });
      });
      const c = l.mtimeMs;
      (l.size !== u.size || c > u.mtimeMs || c === 0) && qt(o.listeners, (f) => f(e, l));
    })
  }, Ht.set(t, o)), () => {
    yt(o, nt, r), yt(o, at, s), nn(o.listeners) && (Ht.delete(t), _e(t), o.options = o.watcher = void 0, Object.freeze(o));
  };
};
class Jr {
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
    const i = this.fsw.options, r = y.dirname(t), s = y.basename(t);
    this.fsw._getWatchedDir(r).add(s);
    const a = y.resolve(t), l = {
      persistent: i.persistent
    };
    n || (n = oe);
    let u;
    if (i.usePolling) {
      const c = i.interval !== i.binaryInterval;
      l.interval = c && Gr(s) ? i.binaryInterval : i.interval, u = Kr(t, a, l, {
        listener: n,
        rawEmitter: this.fsw._emitRaw
      });
    } else
      u = Vr(t, a, l, {
        listener: n,
        errHandler: this._boundHandleError,
        rawEmitter: this.fsw._emitRaw
      });
    return u;
  }
  /**
   * Watch a file and emit add event if warranted.
   * @returns closer for the watcher instance
   */
  _handleFile(t, n, i) {
    if (this.fsw.closed)
      return;
    const r = y.dirname(t), s = y.basename(t), o = this.fsw._getWatchedDir(r);
    let a = n;
    if (o.has(s))
      return;
    const l = async (c, f) => {
      if (this.fsw._throttle(Ur, t, 5)) {
        if (!f || f.mtimeMs === 0)
          try {
            const h = await re(t);
            if (this.fsw.closed)
              return;
            const d = h.atimeMs, m = h.mtimeMs;
            if ((!d || d <= m || m !== a.mtimeMs) && this.fsw._emit(G.CHANGE, t, h), (xr || Mr || Wr) && a.ino !== h.ino) {
              this.fsw._closeFile(c), a = h;
              const w = this._watchWithNodeFs(t, l);
              w && this.fsw._addPathCloser(c, w);
            } else
              a = h;
          } catch {
            this.fsw._remove(r, s);
          }
        else if (o.has(s)) {
          const h = f.atimeMs, d = f.mtimeMs;
          (!h || h <= d || d !== a.mtimeMs) && this.fsw._emit(G.CHANGE, t, f), a = f;
        }
      }
    }, u = this._watchWithNodeFs(t, l);
    if (!(i && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(t)) {
      if (!this.fsw._throttle(G.ADD, t, 0))
        return;
      this.fsw._emit(G.ADD, t, n);
    }
    return u;
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
        a = await Ut(i);
      } catch {
        return this.fsw._emitReady(), !0;
      }
      return this.fsw.closed ? void 0 : (o.has(r) ? this.fsw._symlinkPaths.get(s) !== a && (this.fsw._symlinkPaths.set(s, a), this.fsw._emit(G.CHANGE, i, t.stats)) : (o.add(r), this.fsw._symlinkPaths.set(s, a), this.fsw._emit(G.ADD, i, t.stats)), this.fsw._emitReady(), !0);
    }
    if (this.fsw._symlinkPaths.has(s))
      return !0;
    this.fsw._symlinkPaths.set(s, !0);
  }
  _handleRead(t, n, i, r, s, o, a) {
    if (t = y.join(t, ""), a = this.fsw._throttle("readdir", t, 1e3), !a)
      return;
    const l = this.fsw._getWatchedDir(i.path), u = /* @__PURE__ */ new Set();
    let c = this.fsw._readdirp(t, {
      fileFilter: (f) => i.filterPath(f),
      directoryFilter: (f) => i.filterDir(f)
    });
    if (c)
      return c.on(Lr, async (f) => {
        if (this.fsw.closed) {
          c = void 0;
          return;
        }
        const h = f.path;
        let d = y.join(t, h);
        if (u.add(h), !(f.stats.isSymbolicLink() && await this._handleSymlink(f, t, d, h))) {
          if (this.fsw.closed) {
            c = void 0;
            return;
          }
          (h === r || !r && !l.has(h)) && (this.fsw._incrReadyCount(), d = y.join(s, y.relative(s, d)), this._addToNodeFs(d, n, i, o + 1));
        }
      }).on(G.ERROR, this._boundHandleError), new Promise((f, h) => {
        if (!c)
          return h();
        c.once(tn, () => {
          if (this.fsw.closed) {
            c = void 0;
            return;
          }
          const d = a ? a.clear() : !1;
          f(void 0), l.getChildren().filter((m) => m !== t && !u.has(m)).forEach((m) => {
            this.fsw._remove(t, m);
          }), c = void 0, d && this._handleRead(t, !1, i, r, s, o, a);
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
    const l = this.fsw._getWatchedDir(y.dirname(t)), u = l.has(y.basename(t));
    !(i && this.fsw.options.ignoreInitial) && !s && !u && this.fsw._emit(G.ADD_DIR, t, n), l.add(y.basename(t)), this.fsw._getWatchedDir(t);
    let c, f;
    const h = this.fsw.options.depth;
    if ((h == null || r <= h) && !this.fsw._symlinkPaths.has(a)) {
      if (!s && (await this._handleRead(t, i, o, s, t, r, c), this.fsw.closed))
        return;
      f = this._watchWithNodeFs(t, (d, m) => {
        m && m.mtimeMs === 0 || this._handleRead(d, !1, o, s, t, r, c);
      });
    }
    return f;
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
      const l = await Yr[a.statMethod](a.watchPath);
      if (this.fsw.closed)
        return;
      if (this.fsw._isIgnored(a.watchPath, l))
        return o(), !1;
      const u = this.fsw.options.followSymlinks;
      let c;
      if (l.isDirectory()) {
        const f = y.resolve(t), h = u ? await Ut(t) : t;
        if (this.fsw.closed || (c = await this._handleDir(a.watchPath, l, n, r, s, a, h), this.fsw.closed))
          return;
        f !== h && h !== void 0 && this.fsw._symlinkPaths.set(f, h);
      } else if (l.isSymbolicLink()) {
        const f = u ? await Ut(t) : t;
        if (this.fsw.closed)
          return;
        const h = y.dirname(a.watchPath);
        if (this.fsw._getWatchedDir(h).add(a.watchPath), this.fsw._emit(G.ADD, a.watchPath, l), c = await this._handleDir(h, l, n, r, t, a, f), this.fsw.closed)
          return;
        f !== void 0 && this.fsw._symlinkPaths.set(y.resolve(t), f);
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
const zt = "/", Xr = "//", rn = ".", qr = "..", Qr = "string", Zr = /\\/g, Re = /\/\//, ti = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/, ei = /^\.[/\\]/;
function Ot(e) {
  return Array.isArray(e) ? e : [e];
}
const Gt = (e) => typeof e == "object" && e !== null && !(e instanceof RegExp);
function ni(e) {
  return typeof e == "function" ? e : typeof e == "string" ? (t) => e === t : e instanceof RegExp ? (t) => e.test(t) : typeof e == "object" && e !== null ? (t) => {
    if (e.path === t)
      return !0;
    if (e.recursive) {
      const n = y.relative(e.path, t);
      return n ? !n.startsWith("..") && !y.isAbsolute(n) : !1;
    }
    return !1;
  } : () => !1;
}
function ri(e) {
  if (typeof e != "string")
    throw new Error("string expected");
  e = y.normalize(e), e = e.replace(/\\/g, "/");
  let t = !1;
  e.startsWith("//") && (t = !0);
  const n = /\/\//;
  for (; e.match(n); )
    e = e.replace(n, "/");
  return t && (e = "/" + e), e;
}
function ii(e, t, n) {
  const i = ri(t);
  for (let r = 0; r < e.length; r++) {
    const s = e[r];
    if (s(i, n))
      return !0;
  }
  return !1;
}
function si(e, t) {
  if (e == null)
    throw new TypeError("anymatch: specify first argument");
  const i = Ot(e).map((r) => ni(r));
  return (r, s) => ii(i, r, s);
}
const Fe = (e) => {
  const t = Ot(e).flat();
  if (!t.every((n) => typeof n === Qr))
    throw new TypeError(`Non-string provided as watch path: ${t}`);
  return t.map(sn);
}, De = (e) => {
  let t = e.replace(Zr, zt), n = !1;
  for (t.startsWith(Xr) && (n = !0); t.match(Re); )
    t = t.replace(Re, zt);
  return n && (t = zt + t), t;
}, sn = (e) => De(y.normalize(De(e))), ke = (e = "") => (t) => typeof t == "string" ? sn(y.isAbsolute(t) ? t : y.join(e, t)) : t, oi = (e, t) => y.isAbsolute(e) ? e : y.join(t, e), ai = Object.freeze(/* @__PURE__ */ new Set());
class ci {
  constructor(t, n) {
    this.path = t, this._removeWatcher = n, this.items = /* @__PURE__ */ new Set();
  }
  add(t) {
    const { items: n } = this;
    n && t !== rn && t !== qr && n.add(t);
  }
  async remove(t) {
    const { items: n } = this;
    if (!n || (n.delete(t), n.size > 0))
      return;
    const i = this.path;
    try {
      await sr(i);
    } catch {
      this._removeWatcher && this._removeWatcher(y.dirname(i), y.basename(i));
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
    this.items.clear(), this.path = "", this._removeWatcher = oe, this.items = ai, Object.freeze(this);
  }
}
const li = "stat", ui = "lstat";
class fi {
  constructor(t, n, i) {
    this.fsw = i;
    const r = t;
    this.path = t = t.replace(ei, ""), this.watchPath = r, this.fullWatchPath = y.resolve(r), this.dirParts = [], this.dirParts.forEach((s) => {
      s.length > 1 && s.pop();
    }), this.followSymlinks = n, this.statMethod = n ? li : ui;
  }
  entryPath(t) {
    return y.join(this.watchPath, y.relative(this.watchPath, t.fullPath));
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
class hi extends or {
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
      ignored: t.ignored ? Ot(t.ignored) : Ot([]),
      awaitWriteFinish: n === !0 ? i : typeof n == "object" ? { ...i, ...n } : !1
    };
    jr && (r.usePolling = !0), r.atomic === void 0 && (r.atomic = !r.usePolling);
    const s = process.env.CHOKIDAR_USEPOLLING;
    if (s !== void 0) {
      const l = s.toLowerCase();
      l === "false" || l === "0" ? r.usePolling = !1 : l === "true" || l === "1" ? r.usePolling = !0 : r.usePolling = !!l;
    }
    const o = process.env.CHOKIDAR_INTERVAL;
    o && (r.interval = Number.parseInt(o, 10));
    let a = 0;
    this._emitReady = () => {
      a++, a >= this._readyCount && (this._emitReady = oe, this._readyEmitted = !0, process.nextTick(() => this.emit(D.READY)));
    }, this._emitRaw = (...l) => this.emit(D.RAW, ...l), this._boundRemove = this._remove.bind(this), this.options = r, this._nodeFsHandler = new Jr(this), Object.freeze(r);
  }
  _addIgnoredPath(t) {
    if (Gt(t)) {
      for (const n of this._ignoredPaths)
        if (Gt(n) && n.path === t.path && n.recursive === t.recursive)
          return;
    }
    this._ignoredPaths.add(t);
  }
  _removeIgnoredPath(t) {
    if (this._ignoredPaths.delete(t), typeof t == "string")
      for (const n of this._ignoredPaths)
        Gt(n) && n.path === t && this._ignoredPaths.delete(n);
  }
  // Public methods
  /**
   * Adds paths to be watched on an existing FSWatcher instance.
   * @param paths_ file or file list. Other arguments are unused
   */
  add(t, n, i) {
    const { cwd: r } = this.options;
    this.closed = !1, this._closePromise = void 0;
    let s = Fe(t);
    return r && (s = s.map((o) => oi(o, r))), s.forEach((o) => {
      this._removeIgnoredPath(o);
    }), this._userIgnored = void 0, this._readyCount || (this._readyCount = 0), this._readyCount += s.length, Promise.all(s.map(async (o) => {
      const a = await this._nodeFsHandler._addToNodeFs(o, !i, void 0, 0, n);
      return a && this._emitReady(), a;
    })).then((o) => {
      this.closed || o.forEach((a) => {
        a && this.add(y.dirname(a), y.basename(n || a));
      });
    }), this;
  }
  /**
   * Close watchers or start ignoring events from specified paths.
   */
  unwatch(t) {
    if (this.closed)
      return this;
    const n = Fe(t), { cwd: i } = this.options;
    return n.forEach((r) => {
      !y.isAbsolute(r) && !this._closers.has(r) && (i && (r = y.join(i, r)), r = y.resolve(r)), this._closePath(r), this._addIgnoredPath(r), this._watched.has(r) && this._addIgnoredPath({
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
      const s = (this.options.cwd ? y.relative(this.options.cwd, i) : i) || rn;
      t[s] = n.getChildren().sort();
    }), t;
  }
  emitWithAll(t, n) {
    this.emit(t, ...n), t !== D.ERROR && this.emit(D.ALL, t, ...n);
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
    en && (n = y.normalize(n)), r.cwd && (n = y.relative(r.cwd, n));
    const s = [n];
    i != null && s.push(i);
    const o = r.awaitWriteFinish;
    let a;
    if (o && (a = this._pendingWrites.get(n)))
      return a.lastChange = /* @__PURE__ */ new Date(), this;
    if (r.atomic) {
      if (t === D.UNLINK)
        return this._pendingUnlinks.set(n, [t, ...s]), setTimeout(() => {
          this._pendingUnlinks.forEach((l, u) => {
            this.emit(...l), this.emit(D.ALL, ...l), this._pendingUnlinks.delete(u);
          });
        }, typeof r.atomic == "number" ? r.atomic : 100), this;
      t === D.ADD && this._pendingUnlinks.has(n) && (t = D.CHANGE, this._pendingUnlinks.delete(n));
    }
    if (o && (t === D.ADD || t === D.CHANGE) && this._readyEmitted) {
      const l = (u, c) => {
        u ? (t = D.ERROR, s[0] = u, this.emitWithAll(t, s)) : c && (s.length > 1 ? s[1] = c : s.push(c), this.emitWithAll(t, s));
      };
      return this._awaitWriteFinish(n, o.stabilityThreshold, t, l), this;
    }
    if (t === D.CHANGE && !this._throttle(D.CHANGE, n, 50))
      return this;
    if (r.alwaysStat && i === void 0 && (t === D.ADD || t === D.ADD_DIR || t === D.CHANGE)) {
      const l = r.cwd ? y.join(r.cwd, n) : n;
      let u;
      try {
        u = await re(l);
      } catch {
      }
      if (!u || this.closed)
        return;
      s.push(u);
    }
    return this.emitWithAll(t, s), this;
  }
  /**
   * Common handler for errors
   * @returns The error if defined, otherwise the value of the FSWatcher instance's `closed` flag
   */
  _handleError(t) {
    const n = t && t.code;
    return t && n !== "ENOENT" && n !== "ENOTDIR" && (!this.options.ignorePermissionErrors || n !== "EPERM" && n !== "EACCES") && this.emit(D.ERROR, t), t || this.closed;
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
      const u = r.get(n), c = u ? u.count : 0;
      return r.delete(n), clearTimeout(o), u && clearTimeout(u.timeoutObject), c;
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
    this.options.cwd && !y.isAbsolute(t) && (l = y.join(this.options.cwd, t));
    const u = /* @__PURE__ */ new Date(), c = this._pendingWrites;
    function f(h) {
      nr(l, (d, m) => {
        if (d || !c.has(t)) {
          d && d.code !== "ENOENT" && r(d);
          return;
        }
        const w = Number(/* @__PURE__ */ new Date());
        h && m.size !== h.size && (c.get(t).lastChange = w);
        const _ = c.get(t);
        w - _.lastChange >= n ? (c.delete(t), r(void 0, m)) : a = setTimeout(f, o, m);
      });
    }
    c.has(t) || (c.set(t, {
      lastChange: u,
      cancelWait: () => (c.delete(t), clearTimeout(a), i)
    }), a = setTimeout(f, o));
  }
  /**
   * Determines whether user has asked to ignore this path.
   */
  _isIgnored(t, n) {
    if (this.options.atomic && ti.test(t))
      return !0;
    if (!this._userIgnored) {
      const { cwd: i } = this.options, s = (this.options.ignored || []).map(ke(i)), a = [...[...this._ignoredPaths].map(ke(i)), ...s];
      this._userIgnored = si(a);
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
    return new fi(t, this.options.followSymlinks, this);
  }
  // Directory helpers
  // -----------------
  /**
   * Provides directory tracking objects
   * @param directory path of the directory
   */
  _getWatchedDir(t) {
    const n = y.resolve(t);
    return this._watched.has(n) || this._watched.set(n, new ci(n, this._boundRemove)), this._watched.get(n);
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
    const r = y.join(t, n), s = y.resolve(r);
    if (i = i ?? (this._watched.has(r) || this._watched.has(s)), !this._throttle("remove", r, 100))
      return;
    !i && this._watched.size === 1 && this.add(t, n, !0), this._getWatchedDir(r).getChildren().forEach((h) => this._remove(r, h));
    const l = this._getWatchedDir(t), u = l.has(n);
    l.remove(n), this._symlinkPaths.has(s) && this._symlinkPaths.delete(s);
    let c = r;
    if (this.options.cwd && (c = y.relative(this.options.cwd, r)), this.options.awaitWriteFinish && this._pendingWrites.has(c) && this._pendingWrites.get(c).cancelWait() === D.ADD)
      return;
    this._watched.delete(r), this._watched.delete(s);
    const f = i ? D.UNLINK_DIR : D.UNLINK;
    u && !this._isIgnored(r) && this._emit(f, r), this._closePath(r);
  }
  /**
   * Closes all watchers for a path
   */
  _closePath(t) {
    this._closeFile(t);
    const n = y.dirname(t);
    this._getWatchedDir(n).remove(y.basename(t));
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
    const i = { type: D.ALL, alwaysStat: !0, lstat: !0, ...n, depth: 0 };
    let r = Cr(t, i);
    return this._streams.add(r), r.once(Ar, () => {
      r = void 0;
    }), r.once(tn, () => {
      r && (this._streams.delete(r), r = void 0);
    }), r;
  }
}
function di(e, t = {}) {
  const n = new hi(t);
  return n.add(e), n;
}
var Qt = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function mi(e) {
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
var X = hr, yi = process.cwd, kt = null, pi = process.env.GRACEFUL_FS_PLATFORM || process.platform;
process.cwd = function() {
  return kt || (kt = yi.call(process)), kt;
};
try {
  process.cwd();
} catch {
}
if (typeof process.chdir == "function") {
  var Ie = process.chdir;
  process.chdir = function(e) {
    kt = null, Ie.call(process, e);
  }, Object.setPrototypeOf && Object.setPrototypeOf(process.chdir, Ie);
}
var wi = Ei;
function Ei(e) {
  X.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./) && t(e), e.lutimes || n(e), e.chown = s(e.chown), e.fchown = s(e.fchown), e.lchown = s(e.lchown), e.chmod = i(e.chmod), e.fchmod = i(e.fchmod), e.lchmod = i(e.lchmod), e.chownSync = o(e.chownSync), e.fchownSync = o(e.fchownSync), e.lchownSync = o(e.lchownSync), e.chmodSync = r(e.chmodSync), e.fchmodSync = r(e.fchmodSync), e.lchmodSync = r(e.lchmodSync), e.stat = a(e.stat), e.fstat = a(e.fstat), e.lstat = a(e.lstat), e.statSync = l(e.statSync), e.fstatSync = l(e.fstatSync), e.lstatSync = l(e.lstatSync), e.chmod && !e.lchmod && (e.lchmod = function(c, f, h) {
    h && process.nextTick(h);
  }, e.lchmodSync = function() {
  }), e.chown && !e.lchown && (e.lchown = function(c, f, h, d) {
    d && process.nextTick(d);
  }, e.lchownSync = function() {
  }), pi === "win32" && (e.rename = typeof e.rename != "function" ? e.rename : function(c) {
    function f(h, d, m) {
      var w = Date.now(), _ = 0;
      c(h, d, function v(H) {
        if (H && (H.code === "EACCES" || H.code === "EPERM" || H.code === "EBUSY") && Date.now() - w < 6e4) {
          setTimeout(function() {
            e.stat(d, function(W, dt) {
              W && W.code === "ENOENT" ? c(h, d, v) : m(H);
            });
          }, _), _ < 100 && (_ += 10);
          return;
        }
        m && m(H);
      });
    }
    return Object.setPrototypeOf && Object.setPrototypeOf(f, c), f;
  }(e.rename)), e.read = typeof e.read != "function" ? e.read : function(c) {
    function f(h, d, m, w, _, v) {
      var H;
      if (v && typeof v == "function") {
        var W = 0;
        H = function(dt, pe, we) {
          if (dt && dt.code === "EAGAIN" && W < 10)
            return W++, c.call(e, h, d, m, w, _, H);
          v.apply(this, arguments);
        };
      }
      return c.call(e, h, d, m, w, _, H);
    }
    return Object.setPrototypeOf && Object.setPrototypeOf(f, c), f;
  }(e.read), e.readSync = typeof e.readSync != "function" ? e.readSync : /* @__PURE__ */ function(c) {
    return function(f, h, d, m, w) {
      for (var _ = 0; ; )
        try {
          return c.call(e, f, h, d, m, w);
        } catch (v) {
          if (v.code === "EAGAIN" && _ < 10) {
            _++;
            continue;
          }
          throw v;
        }
    };
  }(e.readSync);
  function t(c) {
    c.lchmod = function(f, h, d) {
      c.open(
        f,
        X.O_WRONLY | X.O_SYMLINK,
        h,
        function(m, w) {
          if (m) {
            d && d(m);
            return;
          }
          c.fchmod(w, h, function(_) {
            c.close(w, function(v) {
              d && d(_ || v);
            });
          });
        }
      );
    }, c.lchmodSync = function(f, h) {
      var d = c.openSync(f, X.O_WRONLY | X.O_SYMLINK, h), m = !0, w;
      try {
        w = c.fchmodSync(d, h), m = !1;
      } finally {
        if (m)
          try {
            c.closeSync(d);
          } catch {
          }
        else
          c.closeSync(d);
      }
      return w;
    };
  }
  function n(c) {
    X.hasOwnProperty("O_SYMLINK") && c.futimes ? (c.lutimes = function(f, h, d, m) {
      c.open(f, X.O_SYMLINK, function(w, _) {
        if (w) {
          m && m(w);
          return;
        }
        c.futimes(_, h, d, function(v) {
          c.close(_, function(H) {
            m && m(v || H);
          });
        });
      });
    }, c.lutimesSync = function(f, h, d) {
      var m = c.openSync(f, X.O_SYMLINK), w, _ = !0;
      try {
        w = c.futimesSync(m, h, d), _ = !1;
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
    }) : c.futimes && (c.lutimes = function(f, h, d, m) {
      m && process.nextTick(m);
    }, c.lutimesSync = function() {
    });
  }
  function i(c) {
    return c && function(f, h, d) {
      return c.call(e, f, h, function(m) {
        u(m) && (m = null), d && d.apply(this, arguments);
      });
    };
  }
  function r(c) {
    return c && function(f, h) {
      try {
        return c.call(e, f, h);
      } catch (d) {
        if (!u(d)) throw d;
      }
    };
  }
  function s(c) {
    return c && function(f, h, d, m) {
      return c.call(e, f, h, d, function(w) {
        u(w) && (w = null), m && m.apply(this, arguments);
      });
    };
  }
  function o(c) {
    return c && function(f, h, d) {
      try {
        return c.call(e, f, h, d);
      } catch (m) {
        if (!u(m)) throw m;
      }
    };
  }
  function a(c) {
    return c && function(f, h, d) {
      typeof h == "function" && (d = h, h = null);
      function m(w, _) {
        _ && (_.uid < 0 && (_.uid += 4294967296), _.gid < 0 && (_.gid += 4294967296)), d && d.apply(this, arguments);
      }
      return h ? c.call(e, f, h, m) : c.call(e, f, m);
    };
  }
  function l(c) {
    return c && function(f, h) {
      var d = h ? c.call(e, f, h) : c.call(e, f);
      return d && (d.uid < 0 && (d.uid += 4294967296), d.gid < 0 && (d.gid += 4294967296)), d;
    };
  }
  function u(c) {
    if (!c || c.code === "ENOSYS")
      return !0;
    var f = !process.getuid || process.getuid() !== 0;
    return !!(f && (c.code === "EINVAL" || c.code === "EPERM"));
  }
}
var Oe = dr.Stream, _i = gi;
function gi(e) {
  return {
    ReadStream: t,
    WriteStream: n
  };
  function t(i, r) {
    if (!(this instanceof t)) return new t(i, r);
    Oe.call(this);
    var s = this;
    this.path = i, this.fd = null, this.readable = !0, this.paused = !1, this.flags = "r", this.mode = 438, this.bufferSize = 64 * 1024, r = r || {};
    for (var o = Object.keys(r), a = 0, l = o.length; a < l; a++) {
      var u = o[a];
      this[u] = r[u];
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
    e.open(this.path, this.flags, this.mode, function(c, f) {
      if (c) {
        s.emit("error", c), s.readable = !1;
        return;
      }
      s.fd = f, s.emit("open", f), s._read();
    });
  }
  function n(i, r) {
    if (!(this instanceof n)) return new n(i, r);
    Oe.call(this), this.path = i, this.fd = null, this.writable = !0, this.flags = "w", this.encoding = "binary", this.mode = 438, this.bytesWritten = 0, r = r || {};
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
var Si = Pi, vi = Object.getPrototypeOf || function(e) {
  return e.__proto__;
};
function Pi(e) {
  if (e === null || typeof e != "object")
    return e;
  if (e instanceof Object)
    var t = { __proto__: vi(e) };
  else
    var t = /* @__PURE__ */ Object.create(null);
  return Object.getOwnPropertyNames(e).forEach(function(n) {
    Object.defineProperty(t, n, Object.getOwnPropertyDescriptor(e, n));
  }), t;
}
var T = Ve, bi = wi, Ti = _i, Ri = Si, vt = mr, x, Nt;
typeof Symbol == "function" && typeof Symbol.for == "function" ? (x = Symbol.for("graceful-fs.queue"), Nt = Symbol.for("graceful-fs.previous")) : (x = "___graceful-fs.queue", Nt = "___graceful-fs.previous");
function Fi() {
}
function on(e, t) {
  Object.defineProperty(e, x, {
    get: function() {
      return t;
    }
  });
}
var rt = Fi;
vt.debuglog ? rt = vt.debuglog("gfs4") : /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && (rt = function() {
  var e = vt.format.apply(vt, arguments);
  e = "GFS4: " + e.split(/\n/).join(`
GFS4: `), console.error(e);
});
if (!T[x]) {
  var Di = Qt[x] || [];
  on(T, Di), T.close = function(e) {
    function t(n, i) {
      return e.call(T, n, function(r) {
        r || Ne(), typeof i == "function" && i.apply(this, arguments);
      });
    }
    return Object.defineProperty(t, Nt, {
      value: e
    }), t;
  }(T.close), T.closeSync = function(e) {
    function t(n) {
      e.apply(T, arguments), Ne();
    }
    return Object.defineProperty(t, Nt, {
      value: e
    }), t;
  }(T.closeSync), /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && process.on("exit", function() {
    rt(T[x]), yr.equal(T[x].length, 0);
  });
}
Qt[x] || on(Qt, T[x]);
var ft = ae(Ri(T));
process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !T.__patched && (ft = ae(T), T.__patched = !0);
function ae(e) {
  bi(e), e.gracefulify = ae, e.createReadStream = pe, e.createWriteStream = we;
  var t = e.readFile;
  e.readFile = n;
  function n(p, g, E) {
    return typeof g == "function" && (E = g, g = null), C(p, g, E);
    function C(L, N, b, R) {
      return t(L, N, function(S) {
        S && (S.code === "EMFILE" || S.code === "ENFILE") ? ot([C, [L, N, b], S, R || Date.now(), Date.now()]) : typeof b == "function" && b.apply(this, arguments);
      });
    }
  }
  var i = e.writeFile;
  e.writeFile = r;
  function r(p, g, E, C) {
    return typeof E == "function" && (C = E, E = null), L(p, g, E, C);
    function L(N, b, R, S, A) {
      return i(N, b, R, function(P) {
        P && (P.code === "EMFILE" || P.code === "ENFILE") ? ot([L, [N, b, R, S], P, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  var s = e.appendFile;
  s && (e.appendFile = o);
  function o(p, g, E, C) {
    return typeof E == "function" && (C = E, E = null), L(p, g, E, C);
    function L(N, b, R, S, A) {
      return s(N, b, R, function(P) {
        P && (P.code === "EMFILE" || P.code === "ENFILE") ? ot([L, [N, b, R, S], P, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  var a = e.copyFile;
  a && (e.copyFile = l);
  function l(p, g, E, C) {
    return typeof E == "function" && (C = E, E = 0), L(p, g, E, C);
    function L(N, b, R, S, A) {
      return a(N, b, R, function(P) {
        P && (P.code === "EMFILE" || P.code === "ENFILE") ? ot([L, [N, b, R, S], P, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  var u = e.readdir;
  e.readdir = f;
  var c = /^v[0-5]\./;
  function f(p, g, E) {
    typeof g == "function" && (E = g, g = null);
    var C = c.test(process.version) ? function(b, R, S, A) {
      return u(b, L(
        b,
        R,
        S,
        A
      ));
    } : function(b, R, S, A) {
      return u(b, R, L(
        b,
        R,
        S,
        A
      ));
    };
    return C(p, g, E);
    function L(N, b, R, S) {
      return function(A, P) {
        A && (A.code === "EMFILE" || A.code === "ENFILE") ? ot([
          C,
          [N, b, R],
          A,
          S || Date.now(),
          Date.now()
        ]) : (P && P.sort && P.sort(), typeof R == "function" && R.call(this, A, P));
      };
    }
  }
  if (process.version.substr(0, 4) === "v0.8") {
    var h = Ti(e);
    v = h.ReadStream, W = h.WriteStream;
  }
  var d = e.ReadStream;
  d && (v.prototype = Object.create(d.prototype), v.prototype.open = H);
  var m = e.WriteStream;
  m && (W.prototype = Object.create(m.prototype), W.prototype.open = dt), Object.defineProperty(e, "ReadStream", {
    get: function() {
      return v;
    },
    set: function(p) {
      v = p;
    },
    enumerable: !0,
    configurable: !0
  }), Object.defineProperty(e, "WriteStream", {
    get: function() {
      return W;
    },
    set: function(p) {
      W = p;
    },
    enumerable: !0,
    configurable: !0
  });
  var w = v;
  Object.defineProperty(e, "FileReadStream", {
    get: function() {
      return w;
    },
    set: function(p) {
      w = p;
    },
    enumerable: !0,
    configurable: !0
  });
  var _ = W;
  Object.defineProperty(e, "FileWriteStream", {
    get: function() {
      return _;
    },
    set: function(p) {
      _ = p;
    },
    enumerable: !0,
    configurable: !0
  });
  function v(p, g) {
    return this instanceof v ? (d.apply(this, arguments), this) : v.apply(Object.create(v.prototype), arguments);
  }
  function H() {
    var p = this;
    Wt(p.path, p.flags, p.mode, function(g, E) {
      g ? (p.autoClose && p.destroy(), p.emit("error", g)) : (p.fd = E, p.emit("open", E), p.read());
    });
  }
  function W(p, g) {
    return this instanceof W ? (m.apply(this, arguments), this) : W.apply(Object.create(W.prototype), arguments);
  }
  function dt() {
    var p = this;
    Wt(p.path, p.flags, p.mode, function(g, E) {
      g ? (p.destroy(), p.emit("error", g)) : (p.fd = E, p.emit("open", E));
    });
  }
  function pe(p, g) {
    return new e.ReadStream(p, g);
  }
  function we(p, g) {
    return new e.WriteStream(p, g);
  }
  var Vn = e.open;
  e.open = Wt;
  function Wt(p, g, E, C) {
    return typeof E == "function" && (C = E, E = null), L(p, g, E, C);
    function L(N, b, R, S, A) {
      return Vn(N, b, R, function(P, Jo) {
        P && (P.code === "EMFILE" || P.code === "ENFILE") ? ot([L, [N, b, R, S], P, A || Date.now(), Date.now()]) : typeof S == "function" && S.apply(this, arguments);
      });
    }
  }
  return e;
}
function ot(e) {
  rt("ENQUEUE", e[0].name, e[1]), T[x].push(e), ce();
}
var Pt;
function Ne() {
  for (var e = Date.now(), t = 0; t < T[x].length; ++t)
    T[x][t].length > 2 && (T[x][t][3] = e, T[x][t][4] = e);
  ce();
}
function ce() {
  if (clearTimeout(Pt), Pt = void 0, T[x].length !== 0) {
    var e = T[x].shift(), t = e[0], n = e[1], i = e[2], r = e[3], s = e[4];
    if (r === void 0)
      rt("RETRY", t.name, n), t.apply(null, n);
    else if (Date.now() - r >= 6e4) {
      rt("TIMEOUT", t.name, n);
      var o = n.pop();
      typeof o == "function" && o.call(null, i);
    } else {
      var a = Date.now() - s, l = Math.max(s - r, 1), u = Math.min(l * 1.2, 100);
      a >= u ? (rt("RETRY", t.name, n), t.apply(null, n.concat([r]))) : T[x].push(e);
    }
    Pt === void 0 && (Pt = setTimeout(ce, 0));
  }
}
(function(e) {
  const t = O.fromCallback, n = ft, i = [
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
  }, e.read = function(r, s, o, a, l, u) {
    return typeof u == "function" ? n.read(r, s, o, a, l, u) : new Promise((c, f) => {
      n.read(r, s, o, a, l, (h, d, m) => {
        if (h) return f(h);
        c({ bytesRead: d, buffer: m });
      });
    });
  }, e.write = function(r, s, ...o) {
    return typeof o[o.length - 1] == "function" ? n.write(r, s, ...o) : new Promise((a, l) => {
      n.write(r, s, ...o, (u, c, f) => {
        if (u) return l(u);
        a({ bytesWritten: c, buffer: f });
      });
    });
  }, e.readv = function(r, s, ...o) {
    return typeof o[o.length - 1] == "function" ? n.readv(r, s, ...o) : new Promise((a, l) => {
      n.readv(r, s, ...o, (u, c, f) => {
        if (u) return l(u);
        a({ bytesRead: c, buffers: f });
      });
    });
  }, e.writev = function(r, s, ...o) {
    return typeof o[o.length - 1] == "function" ? n.writev(r, s, ...o) : new Promise((a, l) => {
      n.writev(r, s, ...o, (u, c, f) => {
        if (u) return l(u);
        a({ bytesWritten: c, buffers: f });
      });
    });
  }, typeof n.realpath.native == "function" ? e.realpath.native = t(n.realpath.native) : process.emitWarning(
    "fs.realpath.native is not a function. Is fs being monkey-patched?",
    "Warning",
    "fs-extra-WARN0003"
  );
})(Y);
var le = {}, an = {};
const ki = k;
an.checkPath = function(t) {
  if (process.platform === "win32" && /[<>:"|?*]/.test(t.replace(ki.parse(t).root, ""))) {
    const i = new Error(`Path contains invalid characters: ${t}`);
    throw i.code = "EINVAL", i;
  }
};
const cn = Y, { checkPath: ln } = an, un = (e) => {
  const t = { mode: 511 };
  return typeof e == "number" ? e : { ...t, ...e }.mode;
};
le.makeDir = async (e, t) => (ln(e), cn.mkdir(e, {
  mode: un(t),
  recursive: !0
}));
le.makeDirSync = (e, t) => (ln(e), cn.mkdirSync(e, {
  mode: un(t),
  recursive: !0
}));
const Ii = O.fromPromise, { makeDir: Oi, makeDirSync: Bt } = le, Vt = Ii(Oi);
var V = {
  mkdirs: Vt,
  mkdirsSync: Bt,
  // alias
  mkdirp: Vt,
  mkdirpSync: Bt,
  ensureDir: Vt,
  ensureDirSync: Bt
};
const Ni = O.fromPromise, fn = Y;
function $i(e) {
  return fn.access(e).then(() => !0).catch(() => !1);
}
var st = {
  pathExists: Ni($i),
  pathExistsSync: fn.existsSync
};
const ct = Y, Ci = O.fromPromise;
async function Li(e, t, n) {
  const i = await ct.open(e, "r+");
  let r = null;
  try {
    await ct.futimes(i, t, n);
  } finally {
    try {
      await ct.close(i);
    } catch (s) {
      r = s;
    }
  }
  if (r)
    throw r;
}
function Ai(e, t, n) {
  const i = ct.openSync(e, "r+");
  return ct.futimesSync(i, t, n), ct.closeSync(i);
}
var hn = {
  utimesMillis: Ci(Li),
  utimesMillisSync: Ai
};
const lt = Y, $ = k, $e = O.fromPromise;
function xi(e, t, n) {
  const i = n.dereference ? (r) => lt.stat(r, { bigint: !0 }) : (r) => lt.lstat(r, { bigint: !0 });
  return Promise.all([
    i(e),
    i(t).catch((r) => {
      if (r.code === "ENOENT") return null;
      throw r;
    })
  ]).then(([r, s]) => ({ srcStat: r, destStat: s }));
}
function Mi(e, t, n) {
  let i;
  const r = n.dereference ? (o) => lt.statSync(o, { bigint: !0 }) : (o) => lt.lstatSync(o, { bigint: !0 }), s = r(e);
  try {
    i = r(t);
  } catch (o) {
    if (o.code === "ENOENT") return { srcStat: s, destStat: null };
    throw o;
  }
  return { srcStat: s, destStat: i };
}
async function Wi(e, t, n, i) {
  const { srcStat: r, destStat: s } = await xi(e, t, i);
  if (s) {
    if (St(r, s)) {
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
  if (r.isDirectory() && ue(e, t))
    throw new Error(Lt(e, t, n));
  return { srcStat: r, destStat: s };
}
function ji(e, t, n, i) {
  const { srcStat: r, destStat: s } = Mi(e, t, i);
  if (s) {
    if (St(r, s)) {
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
  if (r.isDirectory() && ue(e, t))
    throw new Error(Lt(e, t, n));
  return { srcStat: r, destStat: s };
}
async function dn(e, t, n, i) {
  const r = $.resolve($.dirname(e)), s = $.resolve($.dirname(n));
  if (s === r || s === $.parse(s).root) return;
  let o;
  try {
    o = await lt.stat(s, { bigint: !0 });
  } catch (a) {
    if (a.code === "ENOENT") return;
    throw a;
  }
  if (St(t, o))
    throw new Error(Lt(e, n, i));
  return dn(e, t, s, i);
}
function mn(e, t, n, i) {
  const r = $.resolve($.dirname(e)), s = $.resolve($.dirname(n));
  if (s === r || s === $.parse(s).root) return;
  let o;
  try {
    o = lt.statSync(s, { bigint: !0 });
  } catch (a) {
    if (a.code === "ENOENT") return;
    throw a;
  }
  if (St(t, o))
    throw new Error(Lt(e, n, i));
  return mn(e, t, s, i);
}
function St(e, t) {
  return t.ino !== void 0 && t.dev !== void 0 && t.ino === e.ino && t.dev === e.dev;
}
function ue(e, t) {
  const n = $.resolve(e).split($.sep).filter((r) => r), i = $.resolve(t).split($.sep).filter((r) => r);
  return n.every((r, s) => i[s] === r);
}
function Lt(e, t, n) {
  return `Cannot ${n} '${e}' to a subdirectory of itself, '${t}'.`;
}
var ht = {
  // checkPaths
  checkPaths: $e(Wi),
  checkPathsSync: ji,
  // checkParent
  checkParentPaths: $e(dn),
  checkParentPathsSync: mn,
  // Misc
  isSrcSubdir: ue,
  areIdentical: St
};
async function Ui(e, t) {
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
var Yi = {
  asyncIteratorConcurrentProcess: Ui
};
const M = Y, wt = k, { mkdirs: Hi } = V, { pathExists: zi } = st, { utimesMillis: Gi } = hn, Et = ht, { asyncIteratorConcurrentProcess: Bi } = Yi;
async function Vi(e, t, n = {}) {
  typeof n == "function" && (n = { filter: n }), n.clobber = "clobber" in n ? !!n.clobber : !0, n.overwrite = "overwrite" in n ? !!n.overwrite : n.clobber, n.preserveTimestamps && process.arch === "ia32" && process.emitWarning(
    `Using the preserveTimestamps option in 32-bit node is not recommended;

	see https://github.com/jprichardson/node-fs-extra/issues/269`,
    "Warning",
    "fs-extra-WARN0001"
  );
  const { srcStat: i, destStat: r } = await Et.checkPaths(e, t, "copy", n);
  if (await Et.checkParentPaths(e, i, t, "copy"), !await yn(e, t, n)) return;
  const o = wt.dirname(t);
  await zi(o) || await Hi(o), await pn(r, e, t, n);
}
async function yn(e, t, n) {
  return n.filter ? n.filter(e, t) : !0;
}
async function pn(e, t, n, i) {
  const s = await (i.dereference ? M.stat : M.lstat)(t);
  if (s.isDirectory()) return qi(s, e, t, n, i);
  if (s.isFile() || s.isCharacterDevice() || s.isBlockDevice()) return Ki(s, e, t, n, i);
  if (s.isSymbolicLink()) return Qi(e, t, n, i);
  throw s.isSocket() ? new Error(`Cannot copy a socket file: ${t}`) : s.isFIFO() ? new Error(`Cannot copy a FIFO pipe: ${t}`) : new Error(`Unknown file: ${t}`);
}
async function Ki(e, t, n, i, r) {
  if (!t) return Ce(e, n, i, r);
  if (r.overwrite)
    return await M.unlink(i), Ce(e, n, i, r);
  if (r.errorOnExist)
    throw new Error(`'${i}' already exists`);
}
async function Ce(e, t, n, i) {
  if (await M.copyFile(t, n), i.preserveTimestamps) {
    Ji(e.mode) && await Xi(n, e.mode);
    const r = await M.stat(t);
    await Gi(n, r.atime, r.mtime);
  }
  return M.chmod(n, e.mode);
}
function Ji(e) {
  return (e & 128) === 0;
}
function Xi(e, t) {
  return M.chmod(e, t | 128);
}
async function qi(e, t, n, i, r) {
  t || await M.mkdir(i), await Bi(await M.opendir(n), async (s) => {
    const o = wt.join(n, s.name), a = wt.join(i, s.name);
    if (await yn(o, a, r)) {
      const { destStat: u } = await Et.checkPaths(o, a, "copy", r);
      await pn(u, o, a, r);
    }
  }), t || await M.chmod(i, e.mode);
}
async function Qi(e, t, n, i) {
  let r = await M.readlink(t);
  if (i.dereference && (r = wt.resolve(process.cwd(), r)), !e)
    return M.symlink(r, n);
  let s = null;
  try {
    s = await M.readlink(n);
  } catch (o) {
    if (o.code === "EINVAL" || o.code === "UNKNOWN") return M.symlink(r, n);
    throw o;
  }
  if (i.dereference && (s = wt.resolve(process.cwd(), s)), Et.isSrcSubdir(r, s))
    throw new Error(`Cannot copy '${r}' to a subdirectory of itself, '${s}'.`);
  if (Et.isSrcSubdir(s, r))
    throw new Error(`Cannot overwrite '${s}' with '${r}'.`);
  return await M.unlink(n), M.symlink(r, n);
}
var Zi = Vi;
const j = ft, _t = k, ts = V.mkdirsSync, es = hn.utimesMillisSync, gt = ht;
function ns(e, t, n) {
  typeof n == "function" && (n = { filter: n }), n = n || {}, n.clobber = "clobber" in n ? !!n.clobber : !0, n.overwrite = "overwrite" in n ? !!n.overwrite : n.clobber, n.preserveTimestamps && process.arch === "ia32" && process.emitWarning(
    `Using the preserveTimestamps option in 32-bit node is not recommended;

	see https://github.com/jprichardson/node-fs-extra/issues/269`,
    "Warning",
    "fs-extra-WARN0002"
  );
  const { srcStat: i, destStat: r } = gt.checkPathsSync(e, t, "copy", n);
  if (gt.checkParentPathsSync(e, i, t, "copy"), n.filter && !n.filter(e, t)) return;
  const s = _t.dirname(t);
  return j.existsSync(s) || ts(s), wn(r, e, t, n);
}
function wn(e, t, n, i) {
  const s = (i.dereference ? j.statSync : j.lstatSync)(t);
  if (s.isDirectory()) return ls(s, e, t, n, i);
  if (s.isFile() || s.isCharacterDevice() || s.isBlockDevice()) return rs(s, e, t, n, i);
  if (s.isSymbolicLink()) return hs(e, t, n, i);
  throw s.isSocket() ? new Error(`Cannot copy a socket file: ${t}`) : s.isFIFO() ? new Error(`Cannot copy a FIFO pipe: ${t}`) : new Error(`Unknown file: ${t}`);
}
function rs(e, t, n, i, r) {
  return t ? is(e, n, i, r) : En(e, n, i, r);
}
function is(e, t, n, i) {
  if (i.overwrite)
    return j.unlinkSync(n), En(e, t, n, i);
  if (i.errorOnExist)
    throw new Error(`'${n}' already exists`);
}
function En(e, t, n, i) {
  return j.copyFileSync(t, n), i.preserveTimestamps && ss(e.mode, t, n), fe(n, e.mode);
}
function ss(e, t, n) {
  return os(e) && as(n, e), cs(t, n);
}
function os(e) {
  return (e & 128) === 0;
}
function as(e, t) {
  return fe(e, t | 128);
}
function fe(e, t) {
  return j.chmodSync(e, t);
}
function cs(e, t) {
  const n = j.statSync(e);
  return es(t, n.atime, n.mtime);
}
function ls(e, t, n, i, r) {
  return t ? _n(n, i, r) : us(e.mode, n, i, r);
}
function us(e, t, n, i) {
  return j.mkdirSync(n), _n(t, n, i), fe(n, e);
}
function _n(e, t, n) {
  const i = j.opendirSync(e);
  try {
    let r;
    for (; (r = i.readSync()) !== null; )
      fs(r.name, e, t, n);
  } finally {
    i.closeSync();
  }
}
function fs(e, t, n, i) {
  const r = _t.join(t, e), s = _t.join(n, e);
  if (i.filter && !i.filter(r, s)) return;
  const { destStat: o } = gt.checkPathsSync(r, s, "copy", i);
  return wn(o, r, s, i);
}
function hs(e, t, n, i) {
  let r = j.readlinkSync(t);
  if (i.dereference && (r = _t.resolve(process.cwd(), r)), e) {
    let s;
    try {
      s = j.readlinkSync(n);
    } catch (o) {
      if (o.code === "EINVAL" || o.code === "UNKNOWN") return j.symlinkSync(r, n);
      throw o;
    }
    if (i.dereference && (s = _t.resolve(process.cwd(), s)), gt.isSrcSubdir(r, s))
      throw new Error(`Cannot copy '${r}' to a subdirectory of itself, '${s}'.`);
    if (gt.isSrcSubdir(s, r))
      throw new Error(`Cannot overwrite '${s}' with '${r}'.`);
    return ds(r, n);
  } else
    return j.symlinkSync(r, n);
}
function ds(e, t) {
  return j.unlinkSync(t), j.symlinkSync(e, t);
}
var ms = ns;
const ys = O.fromPromise;
var he = {
  copy: ys(Zi),
  copySync: ms
};
const gn = ft, ps = O.fromCallback;
function ws(e, t) {
  gn.rm(e, { recursive: !0, force: !0 }, t);
}
function Es(e) {
  gn.rmSync(e, { recursive: !0, force: !0 });
}
var At = {
  remove: ps(ws),
  removeSync: Es
};
const _s = O.fromPromise, Sn = Y, vn = k, Pn = V, bn = At, Le = _s(async function(t) {
  let n;
  try {
    n = await Sn.readdir(t);
  } catch {
    return Pn.mkdirs(t);
  }
  return Promise.all(n.map((i) => bn.remove(vn.join(t, i))));
});
function Ae(e) {
  let t;
  try {
    t = Sn.readdirSync(e);
  } catch {
    return Pn.mkdirsSync(e);
  }
  t.forEach((n) => {
    n = vn.join(e, n), bn.removeSync(n);
  });
}
var gs = {
  emptyDirSync: Ae,
  emptydirSync: Ae,
  emptyDir: Le,
  emptydir: Le
};
const Ss = O.fromPromise, Tn = k, K = Y, Rn = V;
async function vs(e) {
  let t;
  try {
    t = await K.stat(e);
  } catch {
  }
  if (t && t.isFile()) return;
  const n = Tn.dirname(e);
  let i = null;
  try {
    i = await K.stat(n);
  } catch (r) {
    if (r.code === "ENOENT") {
      await Rn.mkdirs(n), await K.writeFile(e, "");
      return;
    } else
      throw r;
  }
  i.isDirectory() ? await K.writeFile(e, "") : await K.readdir(n);
}
function Ps(e) {
  let t;
  try {
    t = K.statSync(e);
  } catch {
  }
  if (t && t.isFile()) return;
  const n = Tn.dirname(e);
  try {
    K.statSync(n).isDirectory() || K.readdirSync(n);
  } catch (i) {
    if (i && i.code === "ENOENT") Rn.mkdirsSync(n);
    else throw i;
  }
  K.writeFileSync(e, "");
}
var bs = {
  createFile: Ss(vs),
  createFileSync: Ps
};
const Ts = O.fromPromise, Fn = k, Q = Y, Dn = V, { pathExists: Rs } = st, { areIdentical: kn } = ht;
async function Fs(e, t) {
  let n;
  try {
    n = await Q.lstat(t);
  } catch {
  }
  let i;
  try {
    i = await Q.lstat(e);
  } catch (o) {
    throw o.message = o.message.replace("lstat", "ensureLink"), o;
  }
  if (n && kn(i, n)) return;
  const r = Fn.dirname(t);
  await Rs(r) || await Dn.mkdirs(r), await Q.link(e, t);
}
function Ds(e, t) {
  let n;
  try {
    n = Q.lstatSync(t);
  } catch {
  }
  try {
    const s = Q.lstatSync(e);
    if (n && kn(s, n)) return;
  } catch (s) {
    throw s.message = s.message.replace("lstat", "ensureLink"), s;
  }
  const i = Fn.dirname(t);
  return Q.existsSync(i) || Dn.mkdirsSync(i), Q.linkSync(e, t);
}
var ks = {
  createLink: Ts(Fs),
  createLinkSync: Ds
};
const Z = k, pt = Y, { pathExists: Is } = st, Os = O.fromPromise;
async function Ns(e, t) {
  if (Z.isAbsolute(e)) {
    try {
      await pt.lstat(e);
    } catch (s) {
      throw s.message = s.message.replace("lstat", "ensureSymlink"), s;
    }
    return {
      toCwd: e,
      toDst: e
    };
  }
  const n = Z.dirname(t), i = Z.join(n, e);
  if (await Is(i))
    return {
      toCwd: i,
      toDst: e
    };
  try {
    await pt.lstat(e);
  } catch (s) {
    throw s.message = s.message.replace("lstat", "ensureSymlink"), s;
  }
  return {
    toCwd: e,
    toDst: Z.relative(n, e)
  };
}
function $s(e, t) {
  if (Z.isAbsolute(e)) {
    if (!pt.existsSync(e)) throw new Error("absolute srcpath does not exist");
    return {
      toCwd: e,
      toDst: e
    };
  }
  const n = Z.dirname(t), i = Z.join(n, e);
  if (pt.existsSync(i))
    return {
      toCwd: i,
      toDst: e
    };
  if (!pt.existsSync(e)) throw new Error("relative srcpath does not exist");
  return {
    toCwd: e,
    toDst: Z.relative(n, e)
  };
}
var Cs = {
  symlinkPaths: Os(Ns),
  symlinkPathsSync: $s
};
const In = Y, Ls = O.fromPromise;
async function As(e, t) {
  if (t) return t;
  let n;
  try {
    n = await In.lstat(e);
  } catch {
    return "file";
  }
  return n && n.isDirectory() ? "dir" : "file";
}
function xs(e, t) {
  if (t) return t;
  let n;
  try {
    n = In.lstatSync(e);
  } catch {
    return "file";
  }
  return n && n.isDirectory() ? "dir" : "file";
}
var Ms = {
  symlinkType: Ls(As),
  symlinkTypeSync: xs
};
const Ws = O.fromPromise, On = k, B = Y, { mkdirs: js, mkdirsSync: Us } = V, { symlinkPaths: Ys, symlinkPathsSync: Hs } = Cs, { symlinkType: zs, symlinkTypeSync: Gs } = Ms, { pathExists: Bs } = st, { areIdentical: Nn } = ht;
async function Vs(e, t, n) {
  let i;
  try {
    i = await B.lstat(t);
  } catch {
  }
  if (i && i.isSymbolicLink()) {
    const [a, l] = await Promise.all([
      B.stat(e),
      B.stat(t)
    ]);
    if (Nn(a, l)) return;
  }
  const r = await Ys(e, t);
  e = r.toDst;
  const s = await zs(r.toCwd, n), o = On.dirname(t);
  return await Bs(o) || await js(o), B.symlink(e, t, s);
}
function Ks(e, t, n) {
  let i;
  try {
    i = B.lstatSync(t);
  } catch {
  }
  if (i && i.isSymbolicLink()) {
    const a = B.statSync(e), l = B.statSync(t);
    if (Nn(a, l)) return;
  }
  const r = Hs(e, t);
  e = r.toDst, n = Gs(r.toCwd, n);
  const s = On.dirname(t);
  return B.existsSync(s) || Us(s), B.symlinkSync(e, t, n);
}
var Js = {
  createSymlink: Ws(Vs),
  createSymlinkSync: Ks
};
const { createFile: xe, createFileSync: Me } = bs, { createLink: We, createLinkSync: je } = ks, { createSymlink: Ue, createSymlinkSync: Ye } = Js;
var Xs = {
  // file
  createFile: xe,
  createFileSync: Me,
  ensureFile: xe,
  ensureFileSync: Me,
  // link
  createLink: We,
  createLinkSync: je,
  ensureLink: We,
  ensureLinkSync: je,
  // symlink
  createSymlink: Ue,
  createSymlinkSync: Ye,
  ensureSymlink: Ue,
  ensureSymlinkSync: Ye
};
function qs(e, { EOL: t = `
`, finalEOL: n = !0, replacer: i = null, spaces: r } = {}) {
  const s = n ? t : "";
  return JSON.stringify(e, i, r).replace(/\n/g, t) + s;
}
function Qs(e) {
  return Buffer.isBuffer(e) && (e = e.toString("utf8")), e.replace(/^\uFEFF/, "");
}
var de = { stringify: qs, stripBom: Qs };
let ut;
try {
  ut = ft;
} catch {
  ut = Ve;
}
const xt = O, { stringify: $n, stripBom: Cn } = de;
async function Zs(e, t = {}) {
  typeof t == "string" && (t = { encoding: t });
  const n = t.fs || ut, i = "throws" in t ? t.throws : !0;
  let r = await xt.fromCallback(n.readFile)(e, t);
  r = Cn(r);
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
const to = xt.fromPromise(Zs);
function eo(e, t = {}) {
  typeof t == "string" && (t = { encoding: t });
  const n = t.fs || ut, i = "throws" in t ? t.throws : !0;
  try {
    let r = n.readFileSync(e, t);
    return r = Cn(r), JSON.parse(r, t.reviver);
  } catch (r) {
    if (i)
      throw r.message = `${e}: ${r.message}`, r;
    return null;
  }
}
async function no(e, t, n = {}) {
  const i = n.fs || ut, r = $n(t, n);
  await xt.fromCallback(i.writeFile)(e, r, n);
}
const ro = xt.fromPromise(no);
function io(e, t, n = {}) {
  const i = n.fs || ut, r = $n(t, n);
  return i.writeFileSync(e, r, n);
}
var so = {
  readFile: to,
  readFileSync: eo,
  writeFile: ro,
  writeFileSync: io
};
const bt = so;
var oo = {
  // jsonfile exports
  readJson: bt.readFile,
  readJsonSync: bt.readFileSync,
  writeJson: bt.writeFile,
  writeJsonSync: bt.writeFileSync
};
const ao = O.fromPromise, Zt = Y, Ln = k, An = V, co = st.pathExists;
async function lo(e, t, n = "utf-8") {
  const i = Ln.dirname(e);
  return await co(i) || await An.mkdirs(i), Zt.writeFile(e, t, n);
}
function uo(e, ...t) {
  const n = Ln.dirname(e);
  Zt.existsSync(n) || An.mkdirsSync(n), Zt.writeFileSync(e, ...t);
}
var me = {
  outputFile: ao(lo),
  outputFileSync: uo
};
const { stringify: fo } = de, { outputFile: ho } = me;
async function mo(e, t, n = {}) {
  const i = fo(t, n);
  await ho(e, i, n);
}
var yo = mo;
const { stringify: po } = de, { outputFileSync: wo } = me;
function Eo(e, t, n) {
  const i = po(t, n);
  wo(e, i, n);
}
var _o = Eo;
const go = O.fromPromise, U = oo;
U.outputJson = go(yo);
U.outputJsonSync = _o;
U.outputJSON = U.outputJson;
U.outputJSONSync = U.outputJsonSync;
U.writeJSON = U.writeJson;
U.writeJSONSync = U.writeJsonSync;
U.readJSON = U.readJson;
U.readJSONSync = U.readJsonSync;
var So = U;
const vo = Y, He = k, { copy: Po } = he, { remove: xn } = At, { mkdirp: bo } = V, { pathExists: To } = st, ze = ht;
async function Ro(e, t, n = {}) {
  const i = n.overwrite || n.clobber || !1, { srcStat: r, isChangingCase: s = !1 } = await ze.checkPaths(e, t, "move", n);
  await ze.checkParentPaths(e, r, t, "move");
  const o = He.dirname(t);
  return He.parse(o).root !== o && await bo(o), Fo(e, t, i, s);
}
async function Fo(e, t, n, i) {
  if (!i) {
    if (n)
      await xn(t);
    else if (await To(t))
      throw new Error("dest already exists.");
  }
  try {
    await vo.rename(e, t);
  } catch (r) {
    if (r.code !== "EXDEV")
      throw r;
    await Do(e, t, n);
  }
}
async function Do(e, t, n) {
  return await Po(e, t, {
    overwrite: n,
    errorOnExist: !0,
    preserveTimestamps: !0
  }), xn(e);
}
var ko = Ro;
const Mn = ft, te = k, Io = he.copySync, Wn = At.removeSync, Oo = V.mkdirpSync, Ge = ht;
function No(e, t, n) {
  n = n || {};
  const i = n.overwrite || n.clobber || !1, { srcStat: r, isChangingCase: s = !1 } = Ge.checkPathsSync(e, t, "move", n);
  return Ge.checkParentPathsSync(e, r, t, "move"), $o(t) || Oo(te.dirname(t)), Co(e, t, i, s);
}
function $o(e) {
  const t = te.dirname(e);
  return te.parse(t).root === t;
}
function Co(e, t, n, i) {
  if (i) return Kt(e, t, n);
  if (n)
    return Wn(t), Kt(e, t, n);
  if (Mn.existsSync(t)) throw new Error("dest already exists.");
  return Kt(e, t, n);
}
function Kt(e, t, n) {
  try {
    Mn.renameSync(e, t);
  } catch (i) {
    if (i.code !== "EXDEV") throw i;
    return Lo(e, t, n);
  }
}
function Lo(e, t, n) {
  return Io(e, t, {
    overwrite: n,
    errorOnExist: !0,
    preserveTimestamps: !0
  }), Wn(e);
}
var Ao = No;
const xo = O.fromPromise;
var Mo = {
  move: xo(ko),
  moveSync: Ao
}, Wo = {
  // Export promiseified graceful-fs:
  ...Y,
  // Export extra methods:
  ...he,
  ...gs,
  ...Xs,
  ...So,
  ...V,
  ...Mo,
  ...me,
  ...st,
  ...At
};
const et = /* @__PURE__ */ mi(Wo);
Se ? $t.setFfmpegPath(Se.replace("app.asar", "app.asar.unpacked")) : console.error("ffmpeg-static not found");
Yt && Yt.path ? $t.setFfprobePath(Yt.path.replace("app.asar", "app.asar.unpacked")) : console.error("ffprobe-static not found");
async function ye(e) {
  try {
    const t = await jo(e.file_path), n = await Uo(e.file_path, e.id, t.duration);
    return {
      ...e,
      // Keep parsed title and year from filename
      title: e.title,
      original_title: e.title,
      year: e.year,
      plot: t.duration ? `Duration: ${Yo(t.duration)}` : null,
      poster_path: n,
      // Path to generated thumbnail
      backdrop_path: null,
      rating: null
    };
  } catch (t) {
    return console.error("Error extracting metadata:", t), e;
  }
}
async function jo(e) {
  return new Promise((t, n) => {
    $t.ffprobe(e, (i, r) => {
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
async function Uo(e, t, n) {
  try {
    const i = k.join(it.getPath("userData"), "thumbnails");
    await et.ensureDir(i);
    const r = k.join(i, `${t}.jpg`);
    if (await et.pathExists(r))
      return r;
    let s = 10;
    return typeof n == "number" && !isNaN(n) && n > 0 && (s = n * 0.1), new Promise((o, a) => {
      $t(e).screenshots({
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
function Yo(e) {
  const t = Math.floor(e / 3600), n = Math.floor(e % 3600 / 60);
  return t > 0 ? `${t}h ${n}m` : `${n}m`;
}
const Ho = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  fetchMetadata: ye
}, Symbol.toStringTag, { value: "Module" }));
function Mt() {
  var o;
  const e = It(), t = Jt(), n = new Map(t.map((a) => [a.name, a.id])), i = /* @__PURE__ */ new Map();
  for (const a of e) {
    const l = k.dirname(a.file_path), u = k.basename(l);
    i.has(u) || i.set(u, []), (o = i.get(u)) == null || o.push(a);
  }
  let r = 0, s = 0;
  for (const [a, l] of i) {
    if (l.length < 2) continue;
    let u = n.get(a);
    if (!u) {
      Xe(a);
      const c = Jt().find((f) => f.name === a);
      c && (u = c.id, n.set(a, u), r++);
    }
    if (u)
      for (const c of l)
        Qe(u, c.id), s++;
  }
  return qe(), { created: r, added: s };
}
const zo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  generateDefaultPlaylists: Mt
}, Symbol.toStringTag, { value: "Module" }));
let Tt = null;
const jn = [".mkv", ".mp4", ".avi", ".mov", ".wmv"];
function Un() {
  const e = ie().map((t) => t.path);
  e.length !== 0 && (Tt && Tt.close(), Tt = di(e, {
    ignored: /(^|[\/\\])\../,
    // ignore dotfiles
    persistent: !0,
    depth: 5,
    ignoreInitial: !0
    // We handle initial sync manually
  }), Tt.on("add", (t) => {
    const n = k.extname(t).toLowerCase();
    jn.includes(n) && Yn(t);
  }).on("unlink", (t) => {
    Hn(t);
  }), Go());
}
function Go() {
  console.log("Watcher: Syncing library...");
  const e = It(), t = ie().map((o) => o.path);
  let n = 0;
  e.forEach((o) => {
    et.existsSync(o.file_path) || (console.log("Watcher: Found missing file during sync:", o.file_path), Hn(o.file_path), n++);
  });
  let i = 0;
  const r = (o) => {
    try {
      if (!et.existsSync(o)) return;
      const a = et.readdirSync(o);
      for (const l of a) {
        const u = k.join(o, l);
        if (et.statSync(u).isDirectory())
          r(u);
        else {
          const f = k.extname(u).toLowerCase();
          jn.includes(f) && (Ke(u) || (console.log("Watcher: Found new file during sync:", u), Yn(u), i++));
        }
      }
    } catch (a) {
      console.error("Watcher: Error scanning directory:", o, a);
    }
  };
  t.forEach((o) => r(o));
  let s = 0;
  e.forEach((o) => {
    const a = o.poster_path && et.existsSync(o.poster_path), l = o.poster_path && o.poster_path.endsWith("undefined.jpg");
    (!a || l) && (console.log("Watcher: Missing or invalid thumbnail for:", o.title, "ID:", o.id), s++, ye(o).then((u) => {
      u && u.poster_path && (se(o.id, u), tt("library-updated"));
    }).catch((u) => console.error("Watcher: Failed to generate thumbnail for", o.title, u)));
  }), i > 0 || n > 0 || s > 0 ? (console.log(`Watcher: Sync complete. Removed ${n}, Added ${i}, Generating thumbnails for ${s}.`), Mt(), tt("library-updated"), tt("playlists-updated")) : console.log("Watcher: Sync complete. No changes.");
}
function Bo() {
  Un();
}
function Yn(e) {
  if (console.log("Watcher: File add event detected for:", e), Ke(e)) {
    console.log("Watcher: File already exists in DB, skipping:", e);
    return;
  }
  const t = k.basename(e), n = Vo(t), i = {
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
    const r = Je(i);
    tt("library-updated");
    const s = { ...i, id: r.lastInsertRowid };
    ye(s).then((o) => {
      o && (se(r.lastInsertRowid, o), tt("library-updated"));
    }).catch((o) => console.error("Metadata fetch failed:", o)), Mt(), tt("playlists-updated");
  } catch (r) {
    console.error("Failed to add movie:", r);
  }
}
function Hn(e) {
  console.log("Watcher: File remove event detected for:", e);
  try {
    const t = vr(e);
    console.log("Watcher: Database removal result:", t), qe(), tt("library-updated"), tt("playlists-updated");
  } catch (t) {
    console.error("Watcher: Failed to remove movie:", t);
  }
}
function Vo(e) {
  const t = e.replace(/\.[^/.]+$/, ""), n = t.match(/(19|20)\d{2}/);
  let i = n ? parseInt(n[0]) : void 0, r = t;
  return n && (r = t.substring(0, n.index).trim()), r = r.replace(/[._]/g, " ").trim(), { title: r, year: i };
}
function tt(e, t) {
  ne.getAllWindows().forEach((i) => i.webContents.send(e, t));
}
function Ko() {
  F.handle("db:get-library", () => It()), F.handle("db:add-movie", (e, t) => Je(t)), F.handle("db:get-watch-paths", () => ie()), F.handle("db:add-watch-path", (e, t) => Er(t)), F.handle("db:remove-watch-path", (e, t) => _r(t)), F.handle("settings:get", (e, t) => gr(t)), F.handle("settings:set", (e, t, n) => Sr(t, n)), F.handle("db:create-playlist", (e, t) => Xe(t)), F.handle("db:get-playlists", () => Jt()), F.handle("db:delete-playlist", (e, t) => Pr(t)), F.handle("db:add-movie-to-playlist", (e, t, n) => Qe(t, n)), F.handle("db:remove-movie-from-playlist", (e, t, n) => br(t, n)), F.handle("db:get-playlist-movies", (e, t) => Tr(t)), F.handle("db:update-playback-progress", (e, t, n) => Rr(t, n)), F.handle("db:get-playback-progress", (e, t) => Fr(t)), F.handle("db:generate-default-playlists", async () => {
    const { generateDefaultPlaylists: e } = await Promise.resolve().then(() => zo);
    return e();
  }), F.handle("dialog:open-directory", async () => {
    const e = await Kn.showOpenDialog({
      properties: ["openDirectory"]
    });
    return e.canceled ? null : e.filePaths[0];
  }), F.handle("watcher:update", () => {
    Bo();
  }), F.handle("thumbnails:regenerate", async () => {
    const { fetchMetadata: e } = await Promise.resolve().then(() => Ho), t = It();
    console.log(`Regenerating thumbnails for ${t.length} movies...`);
    let n = 0;
    for (const i of t)
      try {
        const r = await e(i);
        r && r.poster_path && (se(i.id, r), n++);
      } catch (r) {
        console.error(`Failed to generate thumbnail for ${i.title}:`, r);
      }
    return console.log(`Generated ${n} thumbnails`), { total: t.length, success: n };
  }), F.handle("media:get-metadata", async (e, t) => {
    const { getMediaMetadata: n } = await import("./ffmpeg-BDWm5NZf.js");
    return n(t);
  }), F.handle("media:extract-subtitle", async (e, t, n) => {
    const { extractSubtitle: i } = await import("./ffmpeg-BDWm5NZf.js");
    return i(t, n);
  }), F.handle("media:extract-subtitle-content", async (e, t, n) => {
    const { extractSubtitleContent: i } = await import("./ffmpeg-BDWm5NZf.js");
    return i(t, n);
  });
}
const zn = J.dirname(Jn(import.meta.url));
process.env.APP_ROOT = J.join(zn, "..");
const ee = process.env.VITE_DEV_SERVER_URL, ya = J.join(process.env.APP_ROOT, "dist-electron"), Gn = J.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ee ? J.join(process.env.APP_ROOT, "public") : Gn;
Be.registerSchemesAsPrivileged([
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
it.commandLine.appendSwitch("enable-experimental-web-platform-features");
let q;
function Bn() {
  q = new ne({
    icon: J.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: J.join(zn, "preload.mjs")
    }
  }), q.webContents.on("did-finish-load", () => {
    q == null || q.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), ee ? q.loadURL(ee) : q.loadFile(J.join(Gn, "index.html"));
}
it.on("window-all-closed", () => {
  process.platform !== "darwin" && (it.quit(), q = null);
});
it.on("activate", () => {
  ne.getAllWindows().length === 0 && Bn();
});
it.whenReady().then(async () => {
  Be.handle("media", async (e) => {
    const t = e.url.replace("media://", ""), n = decodeURIComponent(t);
    console.log("Media request:", { url: t, filePath: n });
    try {
      const r = (await jt.promises.stat(n)).size, s = e.headers.get("Range"), a = ((l) => {
        switch (J.extname(l).toLowerCase()) {
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
        const l = s.replace(/bytes=/, "").split("-"), u = parseInt(l[0], 10), c = l[1] ? parseInt(l[1], 10) : r - 1, f = c - u + 1, h = jt.createReadStream(n, { start: u, end: c });
        return new Response(h, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${u}-${c}/${r}`,
            "Accept-Ranges": "bytes",
            "Content-Length": f.toString(),
            "Content-Type": a
          }
        });
      } else {
        const l = jt.createReadStream(n);
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
  }), wr(), console.log("Database initialized"), Ko(), Un(), Mt(), Bn();
});
export {
  ya as MAIN_DIST,
  Gn as RENDERER_DIST,
  ee as VITE_DEV_SERVER_URL
};

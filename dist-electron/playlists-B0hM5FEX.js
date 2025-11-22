import sysPath__default from "path";
import { g as getMovies, a as getPlaylists, c as createPlaylist, b as addMovieToPlaylist } from "./main-CRDryoKy.js";
function generateDefaultPlaylists() {
  var _a;
  const movies = getMovies();
  const playlists = getPlaylists();
  const playlistMap = new Map(playlists.map((p) => [p.name, p.id]));
  const groupedMovies = /* @__PURE__ */ new Map();
  for (const movie of movies) {
    const dirPath = sysPath__default.dirname(movie.file_path);
    const folderName = sysPath__default.basename(dirPath);
    if (!groupedMovies.has(folderName)) {
      groupedMovies.set(folderName, []);
    }
    (_a = groupedMovies.get(folderName)) == null ? void 0 : _a.push(movie);
  }
  let createdCount = 0;
  let addedCount = 0;
  for (const [folderName, group] of groupedMovies) {
    if (group.length < 2) continue;
    let playlistId = playlistMap.get(folderName);
    if (!playlistId) {
      createPlaylist(folderName);
      const newPlaylist = getPlaylists().find((p) => p.name === folderName);
      if (newPlaylist) {
        playlistId = newPlaylist.id;
        playlistMap.set(folderName, playlistId);
        createdCount++;
      }
    }
    if (playlistId) {
      for (const movie of group) {
        addMovieToPlaylist(playlistId, movie.id);
        addedCount++;
      }
    }
  }
  return { created: createdCount, added: addedCount };
}
export {
  generateDefaultPlaylists
};

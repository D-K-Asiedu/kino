# Kino

Kino is a modern, desktop-based video library manager and player built with Electron and React. It is designed to provide a seamless and aesthetically pleasing experience for organizing and watching your local video collection.

## Features

### 📚 Library Management
- **Automatic Scanning**: Kino watches your specified directories and automatically adds new video files to your library.
- **Metadata Scraping**: Automatically fetches movie details such as title, year, plot, and poster art to populate your library with rich metadata.
- **Organization**: Keeps your collection organized and easily accessible.

### 🎬 Video Player
- **Custom Player**: A fully custom-built video player tailored for a premium viewing experience.
- **Multi-Audio Support**: Easily switch between available audio tracks.
- **Subtitle Support**:
    - Supports embedded subtitles.
    - Loads external subtitle files (e.g., `.srt`, `.vtt`).
- **Playback Control**:
    - Adjustable playback speed.
    - Picture-in-Picture (PiP) mode.
    - Resume playback from where you left off.

### 📑 Playlists
- **Custom Playlists**: Create and manage your own playlists to group movies together.
- **Automatic Generation**: Smartly generates playlists based on your folder structure, making it easy to watch series or collections.

### 🔍 Search & Discovery
- **Instant Search**: Quickly find movies in your library with a responsive search feature.
- **Filtering**: Filter your collection to find exactly what you're looking for.

## Tech Stack

Kino is built using a robust stack of modern web and desktop technologies:

- **Core Framework**: [Electron](https://www.electronjs.org/)
- **Frontend**: [React](https://react.dev/) with [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [TailwindCSS](https://tailwindcss.com/)
- **Database**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for local data persistence.
- **Media Processing**:
    - `fluent-ffmpeg` and `ffmpeg-static` for handling video metadata and processing.
- **File Watching**: `chokidar` for real-time file system monitoring.
- **Routing**: `react-router-dom` for client-side routing.

## Getting Started

### Prerequisites
- **Node.js**: Version 16 or higher is recommended.
- **Package Manager**: npm, yarn, or pnpm.

### Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd kino
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

### Development

To start the application in development mode with hot-reloading:

```bash
npm run dev
```

This command will start the Vite development server and launch the Electron application window.

### Building for Production

To build the application for distribution:

```bash
npm run build
```

This will generate the production-ready files in the `dist` (renderer) and `dist-electron` (main process) directories, and package the application using `electron-builder`.

## Project Structure

The project is organized as follows:

- **`src/`**: Contains the React frontend application.
    - **`components/`**: Reusable UI components (e.g., `Sidebar`, `VideoPlayer`, `MovieCard`).
    - **`pages/`**: Main application views (e.g., `Library`, `PlaylistPage`, `Settings`).
    - **`assets/`**: Static assets like images and icons.
- **`electron/`**: Contains the Electron main process code.
    - **`main.ts`**: The entry point for the Electron application.
    - **`lib/`**: Core backend logic modules:
        - `database.ts`: Database initialization and queries.
        - `ipc.ts`: Inter-Process Communication handlers.
        - `scraper.ts`: Metadata fetching logic.
        - `watcher.ts`: File system watcher logic.
        - `playlists.ts`: Playlist management logic.
        - `ffmpeg.ts`: Media processing utilities.

## License

[Add License Information Here]

import * as fs from 'fs'
import path from 'path'
import episodeParser from 'episode-parser'
import walk from 'walk'
import OS from 'opensubtitles.com'
import OS_API from 'opensubtitles-api'
import fetch from 'node-fetch'

if (!process.env.SUBTITLER_SRC_DIR) {
  process.stderr.write('missing SUBTITLER_SRC_DIR\n')
  process.exit(1)
}
const sourceDirectory = process.env.SUBTITLER_SRC_DIR.replace(/\/+$/, '') + '/'

if (
  (!process.env.OSDB_QUERY && !process.env.OSDB_TMDB_ID) ||
    !process.env.OSDB_API_KEY ||
    !process.env.OSDB_LANGUAGE ||
    !process.env.OSDB_USERNAME ||
    !process.env.OSDB_PASSWORD) {
  process.stderr.write('missing OSDB_QUERY/OSDB_TMDB_ID, OSDB_API_KEY, OSDB_LANGUAGE, OSDB_USERNAME or OSDB_PASSWORD\n')
  process.exit(1)
}
const os = new OS({
  apikey: process.env.OSDB_API_KEY,
  useragent: process.env.OSDB_USERAGENT,
})
const OpenSubtitles = new OS_API({
  useragent: process.env.OSDB_USERAGENT,
  username: process.env.OSDB_USERNAME,
  password: process.env.OSDB_PASSWORD,
  ssl: true
})

const pathToSrt = (path) => path.substring(0, path.length - 3) + 'srt'
const getSubtitleFromOpenSubtitle = async (path, episode) => {
  const { moviehash } = await OpenSubtitles.hash(path)
  try {
    const searchTerms = {}
    if (process.env.OSDB_QUERY) searchTerms.query = process.env.OSDB_QUERY
    if (process.env.OSDB_TMDB_ID) searchTerms.tmdb_id = parseInt(process.env.OSDB_TMDB_ID, 10)
    const { data } = await os.subtitles({
      moviehash,
      season_number: episode.season,
      episode_number: episode.episode,
      ...searchTerms
      // sending `languages` here should work but it throws an error
    })
    const sub = data.filter((row) => row.attributes.language === process.env.OSDB_LANGUAGE)[0]
    if (!sub) {
      process.stderr.write(`subtitle not found for ${path}\n`)
      return
    }

    const { link } = await os.download({
      file_id: sub.attributes.files[0].file_id
    })
    const response = await fetch(link)
    const text = await response.text()
    fs.writeFileSync(pathToSrt(path), text)
  } catch (e) {
    process.stderr.write(`failed to fetch subtitle for ${path}: ${e.toString()}\n`)
  }
}

(async () => {
  await os.login({
    username: process.env.OSDB_USERNAME,
    password: process.env.OSDB_PASSWORD
  })
  const processFile = async (filePath) => {
    process.stderr.write(`Processing file ${filePath}\n`)
    const episode = episodeParser(path.basename(filePath).replace(/_/, ' '))
    if (!episode) {
      process.stderr.write(`failed to parse episode for file at ${filePath}\n`)
      return
    }
    await getSubtitleFromOpenSubtitle(filePath, episode)
  }

  walk.walk(sourceDirectory, {
    followLinks: true,
    listeners: {
      file: async (root, fileStats, next) => {
        try {
          if (fileStats.type !== 'file') {
            process.stderr.write(`skipping not a file ${fileStats.name}\n`)
            return
          }
          if (fileStats.name.endsWith('.srt')) {
            process.stderr.write(`skipping subtitle file ${fileStats.name}\n`)
            return
          }
          if (fs.existsSync(path.join(root, pathToSrt(fileStats.name)))) {
            process.stderr.write(`skipping video that has a subtitle ${fileStats.name}\n`)
            return
          }
          await processFile(path.join(root, fileStats.name))
        } catch (e) {
          console.warn(e)
        } finally {
          next()
        }
      }
    }
  })
})()

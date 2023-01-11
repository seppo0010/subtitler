import * as fs from 'fs'
import path from 'path'
import episodeParser from 'episode-parser'
import walk from 'walk'
import OS from 'opensubtitles.com'
import OS_API from 'opensubtitles-api'
import fetch from 'node-fetch'

const sourceDirectory = (process.env.DATAMAKER_SRC_DIR || 'data').replace(/\/+$/, '') + '/'

if (!process.env.OSDB_API_KEY || !process.env.OSDB_USERNAME || !process.env.OSDB_PASSWORD) {
  process.stderr.write('missing OSDB_API_KEY, OSDB_USERNAME or OSDB_PASSWORD\n')
  process.exit(1)
}
const os = new OS({ apikey: process.env.OSDB_API_KEY })
const OpenSubtitles = new OS_API({
  useragent: process.env.OSDB_USERAGENT,
  username: process.env.OSDB_USERNAME,
  password: process.env.OSDB_PASSWORD,
  ssl: true
})

const getSubtitleFromOpenSubtitle = async (path, episode) => {
  const { moviehash } = await OpenSubtitles.hash(path)
  try {
    const { data } = await os.subtitles({
      moviehash,
      query: process.env.OSDB_QUERY,
      season_number: episode.season,
      episode_number: episode.episode
      // sending `languages` here should work but it throws an error
    })
    const sub = data.filter((row) => row.attributes.language === process.env.OSDB_LANGUAGE)[0]
    if (!sub) return
    const { link } = await os.download({
      file_id: sub.attributes.files[0].file_id
    })
    const response = await fetch(link)
    const text = await response.text()
    // This is a bad side-effect... maybe it should be a configuration...
    fs.writeFileSync(path.substring(0, path.length - 3) + 'srt', text)
  } catch (e) {
    process.stderr.write(`failed to fetch subtitle for ${path}: ${e.toString()}`)
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
        if (fileStats.type !== 'file') return
        try {
          await processFile(path.join(root, fileStats.name))
        } catch (e) {
          console.warn(e)
        }
        next()
      }
    }
  })
})()

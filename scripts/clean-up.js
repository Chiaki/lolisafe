const path = require('path')
const paths = require('../controllers/pathsController')
const utils = require('../controllers/utilsController')
const config = require('./../config')
const db = require('knex')(config.database)

const self = {
  mode: null
}

self.getFiles = async directory => {
  const names = await paths.readdir(directory)
  const files = []
  for (const name of names) {
    const lstat = await paths.lstat(path.join(directory, name))
    if (lstat.isFile() && !name.startsWith('.'))
      files.push(name)
  }
  return files
}

;(async () => {
  const location = process.argv[1].replace(process.cwd() + '/', '')
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h'))
    return console.log(utils.stripIndents(`
      Clean up files that are not in the database.

      Usage:
      node ${location} [mode=0|1|2]

      mode:
      0 = Only list names of files that are not in the database.
      1 = Clean up the files.
    `))

  self.mode = parseInt(args[0]) || 0
  const dryrun = self.mode === 0

  const uploads = await self.getFiles(paths.uploads)
  console.log(`Uploads: ${uploads.length}`)

  const uploadsDb = await db.table('files')
    .select('name')
    .then(rows => rows.map(row => row.name))
  console.log(`- In DB: ${uploadsDb.length}`)

  const uploadsNotInDb = uploads.filter(upload => !uploadsDb.includes(upload))
  console.log(`- Not in DB: ${uploadsNotInDb.length}`)

  const thumbs = await self.getFiles(paths.thumbs)
  console.log(`Thumbs: ${thumbs.length}`)

  const uploadsDbSet = new Set(uploadsDb.map(upload => upload.split('.')[0]))
  const thumbsNotInDb = thumbs.filter(thumb => !uploadsDbSet.has(thumb.slice(0, -4)))
  console.log(`- Not in DB: ${thumbsNotInDb.length}`)

  if (dryrun) {
    console.log('U:', uploadsNotInDb.join(', '))
    console.log('T:', thumbsNotInDb.join(', '))
  } else if (!dryrun) {
    for (const upload of uploadsNotInDb) {
      await paths.unlink(path.join(paths.uploads, upload))
      console.log(`${upload}: OK`)
    }
    for (const thumb of thumbsNotInDb) {
      await paths.unlink(path.join(paths.thumbs, thumb))
      console.log(`${thumb}: OK`)
    }
  }
})()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })

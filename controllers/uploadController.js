const crypto = require('crypto')
const fetch = require('node-fetch')
const fs = require('fs')
const multer = require('multer')
const path = require('path')
const randomstring = require('randomstring')
const searchQuery = require('search-query-parser')
const paths = require('./pathsController')
const perms = require('./permissionController')
const utils = require('./utilsController')
const config = require('./../config')
const logger = require('./../logger')
const db = require('knex')(config.database)

const self = {}

const fileIdentifierLengthFallback = 32
const fileIdentifierLengthChangeable = !config.uploads.fileIdentifierLength.force &&
  typeof config.uploads.fileIdentifierLength.min === 'number' &&
  typeof config.uploads.fileIdentifierLength.max === 'number'

const maxSize = parseInt(config.uploads.maxSize)
const maxSizeBytes = maxSize * 1e6
const urlMaxSizeBytes = parseInt(config.uploads.urlMaxSize) * 1e6

const maxFilesPerUpload = 20

const chunkedUploads = Boolean(config.uploads.chunkSize)
const chunksData = {}
//  Hard-coded min chunk size of 1 MB (e.g. 50 MB = max 50 chunks)
const maxChunksCount = maxSize

const extensionsFilter = Array.isArray(config.extensionsFilter) &&
  config.extensionsFilter.length
const urlExtensionsFilter = Array.isArray(config.uploads.urlExtensionsFilter) &&
  config.uploads.urlExtensionsFilter.length
const temporaryUploads = Array.isArray(config.uploads.temporaryUploadAges) &&
  config.uploads.temporaryUploadAges.length

const initChunks = async uuid => {
  if (chunksData[uuid] === undefined) {
    const root = path.join(paths.chunks, uuid)
    try {
      await paths.access(root)
    } catch (err) {
      // Re-throw error
      if (err && err.code !== 'ENOENT')
        throw err
      await paths.mkdir(root)
    }
    chunksData[uuid] = { root, chunks: [], size: 0 }
  }
  return chunksData[uuid].root
}

const executeMulter = multer({
  // Guide: https://github.com/expressjs/multer#limits
  limits: {
    fileSize: maxSizeBytes,
    // Maximum number of non-file fields.
    // Dropzone.js will add 6 extra fields for chunked uploads.
    // We don't use them for anything else.
    fields: 6,
    // Maximum number of file fields.
    // Chunked uploads still need to provide only 1 file field.
    // Otherwise, only one of the files will end up being properly stored,
    // and that will also be as a chunk.
    files: maxFilesPerUpload
  },
  fileFilter (req, file, cb) {
    file.extname = utils.extname(file.originalname)
    if (self.isExtensionFiltered(file.extname))
      return cb(`${file.extname ? `${file.extname.substr(1).toUpperCase()} files` : 'Files with no extension'} are not permitted.`)

    // Re-map Dropzone keys so people can manually use the API without prepending 'dz'
    for (const key in req.body) {
      if (!/^dz/.test(key)) continue
      req.body[key.replace(/^dz/, '')] = req.body[key]
      delete req.body[key]
    }

    if (req.body.chunkindex !== undefined && !chunkedUploads)
      return cb('Chunked uploads are disabled at the moment.')
    else
      return cb(null, true)
  },
  storage: multer.diskStorage({
    destination (req, file, cb) {
      // If chunked uploads is disabled or the uploaded file is not a chunk
      if (!chunkedUploads || (req.body.uuid === undefined && req.body.chunkindex === undefined))
        return cb(null, paths.uploads)

      initChunks(req.body.uuid)
        .then(uuidDir => cb(null, uuidDir))
        .catch(error => {
          logger.error(error)
          return cb('Could not process the chunked upload. Try again?')
        })
    },

    filename (req, file, cb) {
      // If chunked uploads is disabled or the uploaded file is not a chunk
      if (!chunkedUploads || (req.body.uuid === undefined && req.body.chunkindex === undefined)) {
        const length = self.parseFileIdentifierLength(req.headers.filelength)
        return self.getUniqueRandomName(length, file.extname)
          .then(name => cb(null, name))
          .catch(error => cb(error))
      }

      // index.extension (i.e. 0, 1, ..., n - will prepend zeros depending on the amount of chunks)
      const digits = req.body.totalchunkcount !== undefined ? `${req.body.totalchunkcount - 1}`.length : 1
      const zeros = new Array(digits + 1).join('0')
      const name = (zeros + req.body.chunkindex).slice(-digits)
      return cb(null, name)
    }
  })
}).array('files[]')

self.isExtensionFiltered = extname => {
  // If empty extension needs to be filtered
  if (!extname && config.filterNoExtension)
    return true

  // If there are extensions that have to be filtered
  if (extname && extensionsFilter) {
    const match = config.extensionsFilter.some(extension => extname === extension.toLowerCase())
    const whitelist = config.extensionsFilterMode === 'whitelist'
    if ((!whitelist && match) || (whitelist && !match))
      return true
  }

  return false
}

self.parseFileIdentifierLength = fileLength => {
  if (!config.uploads.fileIdentifierLength)
    return fileIdentifierLengthFallback

  const parsed = parseInt(fileLength)
  if (isNaN(parsed) ||
    !fileIdentifierLengthChangeable ||
    parsed < config.uploads.fileIdentifierLength.min ||
    parsed > config.uploads.fileIdentifierLength.max)
    return config.uploads.fileIdentifierLength.default || fileIdentifierLengthFallback
  else
    return parsed
}

self.getUniqueRandomName = async (length, extension) => {
  for (let i = 0; i < utils.idMaxTries; i++) {
    const identifier = randomstring.generate(length)
    const name = identifier + extension
    if (config.uploads.cacheFileIdentifiers) {
      if (utils.idSet.has(identifier)) {
        logger.log(`Identifier ${identifier} is already in use (${i + 1}/${utils.idMaxTries}).`)
        continue
      }
      utils.idSet.add(identifier)
      // logger.log(`Added ${identifier} to identifiers cache`)
    } else {
      try {
        await paths.access(path.join(paths.uploads, name))
        logger.log(`${name} is already in use (${i + 1}/${utils.idMaxTries}).`)
        continue
      } catch (error) {
        // Re-throw error
        if (error & error.code !== 'ENOENT')
          throw error
      }
    }
    return name
  }

  throw 'Sorry, we could not allocate a unique random name. Try again?'
}

self.parseUploadAge = age => {
  if (age === undefined || age === null)
    return config.uploads.temporaryUploadAges[0]
  const parsed = parseFloat(age)
  if (config.uploads.temporaryUploadAges.includes(parsed))
    return parsed
  else
    return null
}

self.parseStripTags = stripTags => {
  if (!config.uploads.stripTags)
    return false

  if (config.uploads.stripTags.force || stripTags === undefined)
    return config.uploads.stripTags.default

  return Boolean(parseInt(stripTags))
}

self.upload = async (req, res, next) => {
  let user
  if (config.private === true) {
    user = await utils.authorize(req, res)
    if (!user) return
  } else if (req.headers.token) {
    user = await db.table('users')
      .where('token', req.headers.token)
      .first()
    if (user && (user.enabled === false || user.enabled === 0))
      return res.json({ success: false, description: 'This account has been disabled.' })
  }

  let albumid = parseInt(req.headers.albumid || req.params.albumid)
  if (isNaN(albumid))
    albumid = null

  let age = null
  if (temporaryUploads) {
    age = self.parseUploadAge(req.headers.age)
    if (!age && !config.uploads.temporaryUploadAges.includes(0))
      return res.json({ success: false, description: 'Permanent uploads are not permitted.' })
  }

  try {
    const func = req.body.urls ? self.actuallyUploadUrls : self.actuallyUploadFiles
    await func(req, res, user, albumid, age)
  } catch (error) {
    const isError = error instanceof Error
    if (isError) logger.error(error)
    return res.status(400).json({
      success: false,
      description: isError ? error.toString() : error
    })
  }
}

self.actuallyUploadFiles = async (req, res, user, albumid, age) => {
  const error = await new Promise(resolve => {
    return executeMulter(req, res, err => resolve(err))
  })

  if (error) {
    const suppress = [
      'LIMIT_FILE_SIZE',
      'LIMIT_UNEXPECTED_FILE'
    ]
    if (suppress.includes(error.code))
      throw error.toString()
    else
      throw error
  }

  if (!req.files || !req.files.length)
    throw 'No files.'

  // If chunked uploads is enabled and the uploaded file is a chunk, then just say that it was a success
  const uuid = req.body.uuid
  if (chunkedUploads && chunksData[uuid] !== undefined) {
    req.files.forEach(file => {
      chunksData[uuid].chunks.push(file.filename)
      chunksData[uuid].size += file.size
    })
    return res.json({ success: true })
  }

  const infoMap = req.files.map(file => {
    file.albumid = albumid
    file.age = age
    return {
      path: path.join(paths.uploads, file.filename),
      data: file
    }
  })

  if (config.filterEmptyFile && infoMap.some(file => file.data.size === 0)) {
    // Unlink all files when at least one file is an empty file
    // Should continue even when encountering errors
    await Promise.all(infoMap.map(info =>
      utils.unlinkFile(info.data.filename).catch(logger.error)
    ))

    throw 'Empty files are not allowed.'
  }

  if (utils.clamd.scanner) {
    const scanResult = await self.scanFiles(req, user, infoMap)
    if (scanResult) throw scanResult
  }

  await self.stripTags(req, infoMap)

  const result = await self.storeFilesToDb(req, res, user, infoMap)
  await self.sendUploadResponse(req, res, result)
}

self.actuallyUploadUrls = async (req, res, user, albumid, age) => {
  if (!config.uploads.urlMaxSize)
    throw 'Upload by URLs is disabled at the moment.'

  const urls = req.body.urls
  if (!urls || !(urls instanceof Array))
    throw 'Missing "urls" property (array).'

  if (urls.length > maxFilesPerUpload)
    throw `Maximum ${maxFilesPerUpload} URLs at a time.`

  const downloaded = []
  const infoMap = []
  try {
    await Promise.all(urls.map(async url => {
      const original = path.basename(url).split(/[?#]/)[0]
      const extname = utils.extname(original)

      // Extensions filter
      let filtered = false
      if (['blacklist', 'whitelist'].includes(config.uploads.urlExtensionsFilterMode))
        if (urlExtensionsFilter) {
          const match = config.uploads.urlExtensionsFilter.some(extension => extname === extension.toLowerCase())
          const whitelist = config.uploads.urlExtensionsFilterMode === 'whitelist'
          filtered = ((!whitelist && match) || (whitelist && !match))
        } else {
          throw 'Invalid extensions filter, please contact the site owner.'
        }
      else
        filtered = self.isExtensionFiltered(extname)

      if (filtered)
        throw `${extname ? `${extname.substr(1).toUpperCase()} files` : 'Files with no extension'} are not permitted.`

      if (config.uploads.urlProxy)
        url = config.uploads.urlProxy
          .replace(/{url}/g, encodeURIComponent(url))
          .replace(/{url-noprot}/g, encodeURIComponent(url.replace(/^https?:\/\//, '')))

      // Limit max response body size with maximum allowed size
      const fetchFile = await fetch(url, { size: urlMaxSizeBytes })
      if (fetchFile.status !== 200)
        throw `${fetchFile.status} ${fetchFile.statusText}`

      const headers = fetchFile.headers
      const file = await fetchFile.buffer()

      const length = self.parseFileIdentifierLength(req.headers.filelength)
      const name = await self.getUniqueRandomName(length, extname)

      const destination = path.join(paths.uploads, name)
      await paths.writeFile(destination, file)
      downloaded.push(destination)

      infoMap.push({
        path: destination,
        data: {
          filename: name,
          originalname: original,
          extname,
          mimetype: headers.get('content-type').split(';')[0] || '',
          size: file.byteLength,
          albumid,
          age
        }
      })
    }))

    // If no errors encountered, clear cache of downloaded files
    downloaded.length = 0

    if (utils.clamd.scanner) {
      const scanResult = await self.scanFiles(req, user, infoMap)
      if (scanResult) throw scanResult
    }

    const result = await self.storeFilesToDb(req, res, user, infoMap)
    await self.sendUploadResponse(req, res, result)
  } catch (error) {
    // Unlink all downloaded files when at least one file threw an error from the for-loop
    // Should continue even when encountering errors
    if (downloaded.length)
      await Promise.all(downloaded.map(file =>
        utils.unlinkFile(file).catch(logger.error)
      ))

    const errorString = error.toString()
    const suppress = [
      / over limit:/
    ]
    if (!suppress.some(t => t.test(errorString)))
      throw error
    else
      throw errorString
  }
}

self.finishChunks = async (req, res, next) => {
  if (!chunkedUploads)
    return res.json({ success: false, description: 'Chunked upload is disabled at the moment.' })

  let user
  if (config.private === true) {
    user = await utils.authorize(req, res)
    if (!user) return
  } else if (req.headers.token) {
    user = await db.table('users')
      .where('token', req.headers.token)
      .first()
    if (user && (user.enabled === false || user.enabled === 0))
      return res.json({ success: false, description: 'This account has been disabled.' })
  }

  try {
    await self.actuallyFinishChunks(req, res, user)
  } catch (error) {
    const isError = error instanceof Error
    if (isError) logger.error(error)
    return res.status(400).json({
      success: false,
      description: isError ? error.toString() : error
    })
  }
}

self.actuallyFinishChunks = async (req, res, user) => {
  const check = file => typeof file.uuid !== 'string' ||
    !chunksData[file.uuid] ||
    chunksData[file.uuid].chunks.length < 2

  const files = req.body.files
  if (!Array.isArray(files) || !files.length || files.some(check))
    throw 'An unexpected error occurred.'

  const infoMap = []
  try {
    await Promise.all(files.map(async file => {
      if (chunksData[file.uuid].chunks.length > maxChunksCount)
        throw 'Too many chunks.'

      file.extname = typeof file.original === 'string' ? utils.extname(file.original) : ''
      if (self.isExtensionFiltered(file.extname))
        throw `${file.extname ? `${file.extname.substr(1).toUpperCase()} files` : 'Files with no extension'} are not permitted.`

      if (temporaryUploads) {
        file.age = self.parseUploadAge(file.age)
        if (!file.age && !config.uploads.temporaryUploadAges.includes(0))
          throw 'Permanent uploads are not permitted.'
      }

      file.size = chunksData[file.uuid].size
      if (config.filterEmptyFile && file.size === 0)
        throw 'Empty files are not allowed.'
      else if (file.size > maxSizeBytes)
        throw `File too large. Chunks are bigger than ${maxSize} MB.`

      // Generate name
      const length = self.parseFileIdentifierLength(file.filelength)
      const name = await self.getUniqueRandomName(length, file.extname)

      // Combine chunks
      const destination = path.join(paths.uploads, name)
      await self.combineChunks(destination, file.uuid)

      // Continue even when encountering errors
      await self.cleanUpChunks(file.uuid).catch(logger.error)

      // Double-check file size
      const lstat = await paths.lstat(destination)
      if (lstat.size !== file.size)
        throw 'Chunks size mismatched.'

      let albumid = parseInt(file.albumid)
      if (isNaN(albumid))
        albumid = null

      const data = {
        filename: name,
        originalname: file.original || '',
        extname: file.extname,
        mimetype: file.type || '',
        size: file.size,
        albumid,
        age: file.age
      }

      infoMap.push({ path: destination, data })
    }))

    if (utils.clamd.scanner) {
      const scanResult = await self.scanFiles(req, user, infoMap)
      if (scanResult) throw scanResult
    }

    await self.stripTags(req, infoMap)

    const result = await self.storeFilesToDb(req, res, user, infoMap)
    await self.sendUploadResponse(req, res, result)
  } catch (error) {
    // Clean up leftover chunks
    // Should continue even when encountering errors
    await Promise.all(files.map(file => {
      if (chunksData[file.uuid] !== undefined)
        return self.cleanUpChunks(file.uuid).catch(logger.error)
    }))

    // Re-throw error
    throw error
  }
}

self.combineChunks = async (destination, uuid) => {
  let errorObj
  const writeStream = fs.createWriteStream(destination, { flags: 'a' })

  try {
    chunksData[uuid].chunks.sort()
    for (const chunk of chunksData[uuid].chunks)
      await new Promise((resolve, reject) => {
        fs.createReadStream(path.join(chunksData[uuid].root, chunk))
          .on('error', error => reject(error))
          .on('end', () => resolve())
          .pipe(writeStream, { end: false })
      })
  } catch (error) {
    errorObj = error
  }

  // Close stream
  writeStream.end()

  // Re-throw error
  if (errorObj) throw errorObj
}

self.cleanUpChunks = async (uuid) => {
  // Unlink chunks
  await Promise.all(chunksData[uuid].chunks.map(chunk =>
    paths.unlink(path.join(chunksData[uuid].root, chunk))
  ))
  // Remove UUID dir
  await paths.rmdir(chunksData[uuid].root)
  // Delete cached date
  delete chunksData[uuid]
}

self.scanFiles = async (req, user, infoMap) => {
  // eslint-disable-next-line curly
  if (user && utils.clamd.groupBypass && perms.is(user, utils.clamd.groupBypass)) {
    // logger.log(`[ClamAV]: Skipping ${infoMap.length} file(s), ${utils.clamd.groupBypass} group bypass`)
    return false
  }

  const foundThreats = []
  const results = await Promise.all(infoMap.map(async info => {
    if (utils.clamd.whitelistExtensions && utils.clamd.whitelistExtensions.includes(info.data.extname))
      return // logger.log(`[ClamAV]: Skipping ${info.data.filename}, extension whitelisted`)

    if (utils.clamd.maxSize && info.data.size > utils.clamd.maxSize)
      return // logger.log(`[ClamAV]: Skipping ${info.data.filename}, size ${info.data.size} > ${utils.clamd.maxSize}`)

    const reply = await utils.clamd.scanner.scanFile(info.path, utils.clamd.timeout, utils.clamd.chunkSize)
    if (!reply.includes('OK') || reply.includes('FOUND')) {
      // eslint-disable-next-line no-control-regex
      const foundThreat = reply.replace(/^stream: /, '').replace(/ FOUND\u0000$/, '')
      logger.log(`[ClamAV]: ${info.data.filename}: ${foundThreat} FOUND.`)
      foundThreats.push(foundThreat)
    }
  })).then(() => {
    if (foundThreats.length)
      return `Threat found: ${foundThreats[0]}${foundThreats.length > 1 ? ', and more' : ''}.`
  }).catch(error => {
    logger.error(`[ClamAV]: ${error.toString()}`)
    return 'An unexpected error occurred with ClamAV, please contact the site owner.'
  })

  if (results)
    // Unlink all files when at least one threat is found OR any errors occurred
    // Should continue even when encountering errors
    await Promise.all(infoMap.map(info =>
      utils.unlinkFile(info.data.filename).catch(logger.error)
    ))

  return results
}

self.stripTags = async (req, infoMap) => {
  if (!self.parseStripTags(req.headers.striptags))
    return

  try {
    await Promise.all(infoMap.map(info =>
      utils.stripTags(info.data.filename, info.data.extname)
    ))
  } catch (error) {
    // Unlink all files when at least one threat is found OR any errors occurred
    // Should continue even when encountering errors
    await Promise.all(infoMap.map(info =>
      utils.unlinkFile(info.data.filename).catch(logger.error)
    ))

    // Re-throw error
    throw error
  }
}

self.storeFilesToDb = async (req, res, user, infoMap) => {
  const files = []
  const exists = []
  const albumids = []

  await Promise.all(infoMap.map(async info => {
    // Create hash of the file
    const hash = await new Promise((resolve, reject) => {
      const result = crypto.createHash('md5')
      fs.createReadStream(info.path)
        .on('error', error => reject(error))
        .on('end', () => resolve(result.digest('hex')))
        .on('data', data => result.update(data, 'utf8'))
    })

    // Check if the file exists by checking its hash and size
    const dbFile = await db.table('files')
      .where(function () {
        if (user === undefined)
          this.whereNull('userid')
        else
          this.where('userid', user.id)
      })
      .where({
        hash,
        size: info.data.size
      })
      // Select expirydate to display expiration date of existing files as well
      .select('name', 'expirydate')
      .first()

    if (dbFile) {
      // Continue even when encountering errors
      await utils.unlinkFile(info.data.filename).catch(logger.error)
      // logger.log(`Unlinked ${info.data.filename} since a duplicate named ${dbFile.name} exists`)

      // If on /nojs route, append original file name reported by client
      if (req.path === '/nojs')
        dbFile.original = info.data.originalname

      exists.push(dbFile)
      return
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const data = {
      name: info.data.filename,
      original: info.data.originalname,
      type: info.data.mimetype,
      size: info.data.size,
      hash,
      // Only disable if explicitly set to false in config
      ip: config.uploads.storeIP !== false ? req.ip : null,
      timestamp
    }

    if (user) {
      data.userid = user.id
      data.albumid = info.data.albumid
      if (data.albumid !== null && !albumids.includes(data.albumid))
        albumids.push(data.albumid)
    }

    if (info.data.age)
      data.expirydate = data.timestamp + (info.data.age * 3600) // Hours to seconds

    files.push(data)

    // Generate thumbs, but do not wait
    if (utils.mayGenerateThumb(info.data.extname))
      utils.generateThumbs(info.data.filename, info.data.extname).catch(logger.error)
  }))

  if (files.length) {
    let authorizedIds = []
    if (albumids.length) {
      authorizedIds = await db.table('albums')
        .where({ userid: user.id })
        .whereIn('id', albumids)
        .select('id')
        .then(rows => rows.map(row => row.id))

      // Remove albumid if user do not own the album
      for (const file of files)
        if (file.albumid !== null && !authorizedIds.includes(file.albumid))
          file.albumid = null
    }

    // Insert new files to DB
    await db.table('files').insert(files)
    utils.invalidateStatsCache('uploads')

    // Update albums' timestamp
    if (authorizedIds.length) {
      await db.table('albums')
        .whereIn('id', authorizedIds)
        .update('editedAt', Math.floor(Date.now() / 1000))
      utils.invalidateAlbumsCache(authorizedIds)
    }
  }

  return files.concat(exists)
}

self.sendUploadResponse = async (req, res, result) => {
  // Send response
  res.json({
    success: true,
    files: result.map(file => {
      const map = {
        name: file.name,
        url: `${config.domain}/${file.name}`
      }

      // If a temporary upload, add expiry date
      if (file.expirydate)
        map.expirydate = file.expirydate

      // If on /nojs route, add original name
      if (req.path === '/nojs')
        map.original = file.original

      return map
    })
  })
}

self.delete = async (req, res) => {
  // Map /delete requests to /bulkdelete route
  const id = parseInt(req.body.id)
  const body = {
    field: 'id',
    values: isNaN(id) ? undefined : [id]
  }
  req.body = body
  return self.bulkDelete(req, res)
}

self.bulkDelete = async (req, res) => {
  const user = await utils.authorize(req, res)
  if (!user) return

  const field = req.body.field || 'id'
  const values = req.body.values

  if (!Array.isArray(values) || !values.length)
    return res.json({ success: false, description: 'No array of files specified.' })

  try {
    const failed = await utils.bulkDeleteFromDb(field, values, user)
    return res.json({ success: true, failed })
  } catch (error) {
    logger.error(error)
    return res.status(500).json({ success: false, description: 'An unexpected error occurred. Try again?' })
  }
}

self.list = async (req, res) => {
  const user = await utils.authorize(req, res)
  if (!user) return

  const all = Boolean(req.headers.all)
  const filters = req.headers.filters
  const minoffset = req.headers.minoffset
  const ismoderator = perms.is(user, 'moderator')
  if ((all || filters) && !ismoderator)
    return res.status(403).end()

  const basedomain = config.domain

  const filterObj = {
    uploaders: [],
    excludeUploaders: [],
    queries: {
      exclude: {}
    },
    flags: {}
  }

  const sortObj = {
    // Cast columns to specific type if they are stored differently
    casts: {
      size: 'integer'
    },
    // Columns mapping
    maps: {
      date: 'timestamp',
      expiry: 'expirydate'
    },
    // Columns with which to use SQLite's NULLS LAST option
    nullsLast: [
      'userid',
      'expirydate',
      'ip'
    ],
    parsed: []
  }

  if (filters) {
    const keywords = [
      'ip',
      'user'
    ]
    const ranges = [
      'date',
      'expiry'
    ]
    filterObj.queries = searchQuery.parse(filters, {
      keywords: keywords.concat([
        'sort'
      ]),
      ranges,
      tokenize: true,
      alwaysArray: true,
      offsets: false
    })

    for (const key of keywords) {
      let queryIndex = -1
      let excludeIndex = -1

      // Make sure keyword arrays only contain unique values
      if (filterObj.queries[key]) {
        filterObj.queries[key] = filterObj.queries[key].filter((v, i, a) => a.indexOf(v) === i)
        queryIndex = filterObj.queries[key].indexOf('-')
      }
      if (filterObj.queries.exclude[key]) {
        filterObj.queries.exclude[key] = filterObj.queries.exclude[key].filter((v, i, a) => a.indexOf(v) === i)
        excludeIndex = filterObj.queries.exclude[key].indexOf('-')
      }

      // Flag to match NULL values
      const inQuery = queryIndex !== -1
      const inExclude = excludeIndex !== -1
      if (inQuery || inExclude) {
        // Prioritize exclude keys when both types found
        filterObj.flags[`${key}Null`] = inExclude ? false : inQuery
        if (inQuery) filterObj.queries[key].splice(queryIndex, 1)
        if (inExclude) filterObj.queries.exclude[key].splice(excludeIndex, 1)
      }
    }

    const parseDate = (date, minoffset, resetMs) => {
      // [YYYY][/MM][/DD] [HH][:MM][:SS]
      // e.g. 2020/01/01 00:00:00, 2018/01/01 06, 2019/11, 12:34:00
      const match = date.match(/^(\d{4})?(\/\d{2})?(\/\d{2})?\s?(\d{2})?(:\d{2})?(:\d{2})?$/)

      if (match) {
        const offset = 60000 * (utils.timezoneOffset - minoffset)
        const dateObj = new Date(Date.now() + offset)

        if (match[1] !== undefined)
          dateObj.setFullYear(Number(match[1]), // full year
            match[2] !== undefined ? (Number(match[2].slice(1)) - 1) : 0, // month, zero-based
            match[3] !== undefined ? Number(match[3].slice(1)) : 1) // date

        if (match[4] !== undefined)
          dateObj.setHours(Number(match[4]), // hours
            match[5] !== undefined ? Number(match[5].slice(1)) : 0, // minutes
            match[6] !== undefined ? Number(match[6].slice(1)) : 0) // seconds

        if (resetMs)
          dateObj.setMilliseconds(0)

        // Calculate timezone differences
        const newDateObj = new Date(dateObj.getTime() - offset)
        return newDateObj
      } else {
        return null
      }
    }

    // Parse dates to timestamps
    for (const range of ranges)
      if (filterObj.queries[range]) {
        if (filterObj.queries[range].from) {
          const parsed = parseDate(filterObj.queries[range].from, minoffset, true)
          filterObj.queries[range].from = parsed ? Math.floor(parsed / 1000) : null
        }
        if (filterObj.queries[range].to) {
          const parsed = parseDate(filterObj.queries[range].to, minoffset, true)
          filterObj.queries[range].to = parsed ? Math.ceil(parsed / 1000) : null
        }
      }

    // Query users table for user IDs
    if (filterObj.queries.user || filterObj.queries.exclude.user) {
      const usernames = []
        .concat(filterObj.queries.user || [])
        .concat(filterObj.queries.exclude.user || [])

      const uploaders = await db.table('users')
        .whereIn('username', usernames)
        .select('id', 'username')

      // If no matches, or mismatched results
      if (!uploaders || (uploaders.length !== usernames.length)) {
        const notFound = usernames.filter(username => {
          return !uploaders.find(uploader => uploader.username === username)
        })
        if (notFound)
          return res.json({
            success: false,
            description: `User${notFound.length === 1 ? '' : 's'} not found: ${notFound.join(', ')}.`
          })
      }

      for (const uploader of uploaders)
        if (filterObj.queries.user && filterObj.queries.user.includes(uploader.username))
          filterObj.uploaders.push(uploader)
        else
          filterObj.excludeUploaders.push(uploader)

      delete filterObj.queries.user
      delete filterObj.queries.exclude.user
    }

    // Parse sort keys
    if (filterObj.queries.sort) {
      for (const obQuery of filterObj.queries.sort) {
        const tmp = obQuery.toLowerCase().split(':')

        let column = sortObj.maps[tmp[0]] || tmp[0]
        let direction = 'asc'

        if (sortObj.casts[column])
          column = `cast (\`${column}\` as ${sortObj.casts[column]})`
        if (tmp[1] && /^d/.test(tmp[1]))
          direction = 'desc'

        const suffix = sortObj.nullsLast.includes(column) ? ' nulls last' : ''
        sortObj.parsed.push(`${column} ${direction}${suffix}`)
      }

      delete filterObj.queries.sort
    }

    // For some reason, single value won't be in Array even with 'alwaysArray' option
    if (typeof filterObj.queries.exclude.text === 'string')
      filterObj.queries.exclude.text = [filterObj.queries.exclude.text]
  }

  function filter () {
    if (req.params.id !== undefined)
      this.where('albumid', req.params.id)
    else if (!all)
      this.where('userid', user.id)
    else
      // Sheesh, these look too overbearing...
      this.where(function () {
        // Filter uploads matching any of the supplied 'user' keys and/or NULL flag
        // Prioritze exclude keys when both types found
        if (filterObj.excludeUploaders.length)
          this.orWhereNotIn('userid', filterObj.excludeUploaders.map(v => v.id))
        else if (filterObj.uploaders.length)
          this.orWhereIn('userid', filterObj.uploaders.map(v => v.id))
        // Such overbearing logic for NULL values, smh...
        if ((filterObj.excludeUploaders.length && filterObj.flags.userNull !== false) ||
          (filterObj.uploaders.length && filterObj.flags.userNull) ||
          (!filterObj.excludeUploaders.length && !filterObj.uploaders.length && filterObj.flags.userNull))
          this.orWhereNull('userid')
        else if (filterObj.flags.userNull === false)
          this.orWhereNotNull('userid')
      }).orWhere(function () {
        // Filter uploads matching any of the supplied 'ip' keys and/or NULL flag
        // Same prioritization logics as above
        if (filterObj.queries.exclude.ip)
          this.orWhereNotIn('ip', filterObj.queries.exclude.ip)
        else if (filterObj.queries.ip)
          this.orWhereIn('ip', filterObj.queries.ip)
        // ...
        if ((filterObj.queries.exclude.ip && filterObj.flags.ipNull !== false) ||
          (filterObj.queries.ip && filterObj.flags.ipNull) ||
          (!filterObj.queries.exclude.ip && !filterObj.queries.ip && filterObj.flags.ipNull))
          this.orWhereNull('ip')
        else if (filterObj.flags.ipNull === false)
          this.orWhereNotNull('ip')
      }).andWhere(function () {
        // Then, refine using the supplied 'date' and/or 'expiry' ranges
        if (filterObj.queries.date)
          if (typeof filterObj.queries.date.from === 'number')
            if (typeof filterObj.queries.date.to === 'number')
              this.andWhereBetween('timestamp', [filterObj.queries.date.from, filterObj.queries.date.to])
            else
              this.andWhere('timestamp', '>=', filterObj.queries.date.from)
          else
            this.andWhere('timestamp', '<=', filterObj.queries.date.to)
        if (filterObj.queries.expiry)
          if (typeof filterObj.queries.expiry.from === 'number')
            if (typeof filterObj.queries.expiry.to === 'number')
              this.andWhereBetween('expirydate', [filterObj.queries.expiry.from, filterObj.queries.expiry.to])
            else
              this.andWhere('expirydate', '>=', filterObj.queries.date.from)
          else
            this.andWhere('expirydate', '<=', filterObj.queries.date.to)
      }).andWhere(function () {
        // Then, refine using the supplied keywords against their file names
        if (!filterObj.queries.text) return
        for (const name of filterObj.queries.text)
          if (name.includes('*'))
            this.orWhere('name', 'like', name.replace(/\*/g, '%'))
          else
            // If no asterisks, assume partial
            this.orWhere('name', 'like', `%${name}%`)
      }).andWhere(function () {
        // Finally, refine using the supplied exclusions against their file names
        if (!filterObj.queries.exclude.text) return
        for (const exclude of filterObj.queries.exclude.text)
          if (exclude.includes('*'))
            this.andWhere('name', 'not like', exclude.replace(/\*/g, '%'))
          else
            // If no asterisks, assume partial
            this.andWhere('name', 'not like', `%${exclude}%`)
      })
  }

  try {
    // Query uploads count for pagination
    const count = await db.table('files')
      .where(filter)
      .count('id as count')
      .then(rows => rows[0].count)
    if (!count)
      return res.json({ success: true, files: [], count })

    let offset = req.params.page
    if (offset === undefined) offset = 0

    const columns = ['id', 'name', 'userid', 'size', 'timestamp']
    if (temporaryUploads)
      columns.push('expirydate')

    // Only select IPs if we are listing all uploads
    columns.push(all ? 'ip' : 'albumid')

    const sortRaw = sortObj.parsed.length
      ? sortObj.parsed.join(', ')
      : '`id` desc'
    const files = await db.table('files')
      .where(filter)
      .orderByRaw(sortRaw)
      .limit(25)
      .offset(25 * offset)
      .select(columns)

    if (!files.length)
      return res.json({ success: true, files, count, basedomain })

    for (const file of files) {
      file.extname = utils.extname(file.name)
      if (utils.mayGenerateThumb(file.extname))
        file.thumb = `thumbs/${file.name.slice(0, -file.extname.length)}.png`
    }

    // If we are not listing all uploads, query album names
    let albums = {}
    if (!all) {
      const albumids = files
        .map(file => file.albumid)
        .filter((v, i, a) => {
          return v !== null && v !== undefined && v !== '' && a.indexOf(v) === i
        })
      albums = await db.table('albums')
        .whereIn('id', albumids)
        .where('enabled', 1)
        .where('userid', user.id)
        .select('id', 'name')
        .then(rows => {
          // Build Object indexed by their IDs
          const obj = {}
          for (const row of rows)
            obj[row.id] = row.name
          return obj
        })
    }

    // If we are not listing all uploads, send response
    if (!all)
      return res.json({ success: true, files, count, albums, basedomain })

    // Otherwise proceed to querying usernames
    let usersTable = filterObj.uploaders
    if (!usersTable.length) {
      const userids = files
        .map(file => file.userid)
        .filter((v, i, a) => {
          return v !== null && v !== undefined && v !== '' && a.indexOf(v) === i
        })

      // If there are no uploads attached to a registered user, send response
      if (userids.length === 0)
        return res.json({ success: true, files, count, basedomain })

      // Query usernames of user IDs from currently selected files
      usersTable = await db.table('users')
        .whereIn('id', userids)
        .select('id', 'username')
    }

    const users = {}
    for (const user of usersTable)
      users[user.id] = user.username

    return res.json({ success: true, files, count, users, basedomain })
  } catch (error) {
    // If moderator, capture SQLITE_ERROR and use its error message for the response's description
    let errorString
    if (ismoderator && error.code === 'SQLITE_ERROR') {
      const match = error.message.match(/SQLITE_ERROR: .*$/)
      errorString = match && match[0]
    }

    // If not proper SQLITE_ERROR, log to console
    if (!errorString) {
      logger.error(error)
      res.status(500) // Use 500 status code
    }

    return res.json({
      success: false,
      description: errorString || 'An unexpected error occurred. Try again?'
    })
  }
}

module.exports = self

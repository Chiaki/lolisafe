const routes = require('express').Router()
const uploadController = require('./../controllers/uploadController')
const utils = require('./../controllers/utilsController')
const config = require('./../config')

routes.get('/nojs', async (req, res, next) => {
  return res.render('nojs', {
    config,
    versions: utils.versionStrings,
    gitHash: utils.gitHash
  })
})

routes.post('/nojs', (req, res, next) => {
  res._json = res.json
  res.json = (...args) => {
    const result = args[0]
    return res.render('nojs', {
      config,
      versions: utils.versionStrings,
      gitHash: utils.gitHash,
      errorMessage: result.success ? '' : (result.description || 'An unexpected error occurred.'),
      files: result.files || [{}]
    })
  }
  return uploadController.upload(req, res, next)
})

module.exports = routes

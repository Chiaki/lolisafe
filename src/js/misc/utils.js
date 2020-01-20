/* global lsKeys, page */

// keys for localStorage
lsKeys.siBytes = 'siBytes'

page.prepareShareX = () => {
  const values = page.token ? {
    token: page.token || '',
    albumid: page.album || ''
  } : {}
  values.filelength = page.fileLength || ''
  values.age = page.uploadAge || ''
  values.striptags = page.stripTags || ''

  const headers = []
  const keys = Object.keys(values)
  for (let i = 0; i < keys.length; i++)
    // Pad by 4 space
    headers.push(`    "${keys[i]}": "${values[keys[i]]}"`)

  const origin = (location.hostname + location.pathname).replace(/\/(dashboard)?$/, '')
  const originClean = origin.replace(/\//g, '_')

  const sharexElement = document.querySelector('#ShareX')
  const sharexFile = `{
  "Name": "${originClean}",
  "DestinationType": "ImageUploader, FileUploader",
  "RequestMethod": "POST",
  "RequestURL": "${location.protocol}//${origin}/api/upload",
  "Headers": {
${headers.join(',\n')}
  },
  "Body": "MultipartFormData",
  "FileFormName": "files[]",
  "URL": "$json:files[0].url$",
  "ThumbnailURL": "$json:files[0].url$"
}`

  const sharexBlob = new Blob([sharexFile], { type: 'application/octet-binary' })
  /* eslint-disable-next-line compat/compat */
  sharexElement.setAttribute('href', URL.createObjectURL(sharexBlob))
  sharexElement.setAttribute('download', `${originClean}.sxcu`)
}

page.getPrettyDate = date => {
  return date.getFullYear() + '-' +
    (date.getMonth() < 9 ? '0' : '') + // month's index starts from zero
    (date.getMonth() + 1) + '-' +
    (date.getDate() < 10 ? '0' : '') +
    date.getDate() + ' ' +
    (date.getHours() < 10 ? '0' : '') +
    date.getHours() + ':' +
    (date.getMinutes() < 10 ? '0' : '') +
    date.getMinutes() + ':' +
    (date.getSeconds() < 10 ? '0' : '') +
    date.getSeconds()
}

page.getPrettyBytes = num => {
  // MIT License
  // Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
  if (typeof num !== 'number' && !isFinite(num)) return num

  const si = localStorage[lsKeys.siBytes] !== '0'
  const neg = num < 0 ? '-' : ''
  const scale = si ? 1000 : 1024
  if (neg) num = -num
  if (num < scale) return `${neg}${num} B`

  const exponent = Math.min(Math.floor((Math.log(num) * Math.LOG10E) / 3), 8) // 8 is count of KMGTPEZY
  const numStr = Number((num / Math.pow(scale, exponent)).toPrecision(3))
  const pre = (si ? 'kMGTPEZY' : 'KMGTPEZY').charAt(exponent - 1) + (si ? '' : 'i')
  return `${neg}${numStr} ${pre}B`
}

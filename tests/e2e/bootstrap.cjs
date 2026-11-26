const { app } = require('electron')
const path = require('node:path')
const root = process.env.ZIPPLY_E2E_ROOT
if (!root) throw new Error('ZIPPLY_E2E_ROOT is required')
app.setPath('userData', path.join(root, 'user-data'))
app.setPath('home', root)
require('../../out/main/index.js')

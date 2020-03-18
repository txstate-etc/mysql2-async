/* global before */
import db from '../src'

before(async () => {
  await db.wait()
  await db.execute('DROP TABLE IF EXISTS test')
})

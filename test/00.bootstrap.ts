/* global before */
import db from '../src/db'

before(async function () {
  // on first run, mariadb needs a long time to set up the data volume
  this.timeout(100000)
  await db.wait()
  await db.execute('DROP TABLE IF EXISTS test')
  await db.execute('DROP TABLE IF EXISTS test2')
})

/* global before */
import db from '../src'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)

before(async () => {
  await db.wait()
  await db.execute('DROP TABLE IF EXISTS test')
  await db.execute('DROP TABLE IF EXISTS test2')
})

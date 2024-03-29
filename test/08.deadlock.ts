/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src/db'

describe('deadlock tests', () => {
  it('should throw a deadlock error when there is a deadlock', async () => {
    try {
      await Promise.all([
        db.transaction(async db => {
          await db.update('UPDATE test SET name=:newname WHERE name=:oldname', { oldname: 'name 50', newname: 'name 5000' })
          await new Promise(resolve => setTimeout(resolve, 100))
          await db.update('UPDATE test2 SET name=:newname WHERE name=:oldname', { oldname: 'name 900', newname: 'name 9000' })
        }),
        db.transaction(async db => {
          await new Promise(resolve => setTimeout(resolve, 50))
          await db.update('UPDATE test2 SET name=:newname WHERE name=:oldname', { oldname: 'name 900', newname: 'name 9001' })
          await new Promise(resolve => setTimeout(resolve, 100))
          await db.update('UPDATE test SET name=:newname WHERE name=:oldname', { oldname: 'name 50', newname: 'name 5001' })
        })
      ])
      expect.fail('should have thrown')
    } catch (e: any) {
      expect(e.errno).to.equal(1213)
    }
    const opentransactions = await db.getval('SELECT count(*) FROM information_schema.innodb_trx')
    expect(opentransactions).to.equal(0)
  }).timeout(10000)

  it('should avoid a deadlock error when retries are allowed', async () => {
    const [one, two] = await Promise.all([
      db.transaction(async db => {
        await db.update('UPDATE test SET name=:newname WHERE name=:oldname', { oldname: 'name 30', newname: 'name 3000' })
        await new Promise(resolve => setTimeout(resolve, 100))
        await db.update('UPDATE test2 SET name=:newname WHERE name=:oldname', { oldname: 'name 800', newname: 'name 8000' })
        return 1
      }, { retries: 1 }),
      db.transaction(async db => {
        await new Promise(resolve => setTimeout(resolve, 50))
        await db.update('UPDATE test2 SET name=:newname WHERE name=:oldname', { oldname: 'name 800', newname: 'name 8001' })
        await new Promise(resolve => setTimeout(resolve, 100))
        await db.update('UPDATE test SET name=:newname WHERE name=:oldname', { oldname: 'name 30', newname: 'name 3001' })
        return 2
      }, { retries: 1 })
    ])
    expect(one).to.equal(1, 'not returning value correctly after a retry')
    expect(two).to.equal(2, 'not returning value correctly after a retry')
  }).timeout(10000)
})

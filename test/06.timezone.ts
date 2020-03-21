/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src/db'
import Db from '../src'

const nofixdb = new Db({ skiptzfix: true })

function expectSameTime (date1: Date, date2: Date) {
  expect(Math.abs(date1.getTime() - date2.getTime())).to.be.lessThan(5000)
}

function expectNotSameTime (date1: Date, date2: Date) {
  expect(Math.abs(date1.getTime() - date2.getTime())).to.be.greaterThan(5000)
}

describe('timezone tests', () => {
  it('should automatically generate dates in UTC', async () => {
    const tz = await db.getval<Date>('SELECT modified FROM test LIMIT 1')
    expect(tz).to.be.a('Date')
    expectSameTime(tz!, new Date())
  })

  it('should get an incorrect javascript Date from UTC dates if skipping the timezone fix', async () => {
    const nofixtz = await nofixdb.getval<Date>('SELECT modified FROM test LIMIT 1')
    expect(nofixtz).to.be.a('Date')
    expectNotSameTime(nofixtz!, new Date())
  })

  it('should treat new Date() from client and NOW() in sql as the same date', async () => {
    await db.update('UPDATE test SET modified=NOW() WHERE id=?', [19])
    const now = await db.getval<Date>('SELECT modified FROM test WHERE id=?', [19])
    await db.update('UPDATE test SET modified=? WHERE id=?', [new Date(), 19])
    const newdate = await db.getval<Date>('SELECT modified FROM test WHERE id=?', [19])
    expectSameTime(now!, newdate!)
  })

  it('should not treat new Date() from client and NOW() in sql as the same date if skipping time zone fix', async () => {
    await nofixdb.update('UPDATE test SET modified=NOW() WHERE id=?', [19])
    const now = await nofixdb.getval<Date>('SELECT modified FROM test WHERE id=?', [19])
    await nofixdb.update('UPDATE test SET modified=? WHERE id=?', [new Date(), 19])
    const newdate = await nofixdb.getval<Date>('SELECT modified FROM test WHERE id=?', [19])
    expectNotSameTime(now!, newdate!)
  })
})

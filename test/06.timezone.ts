/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src/db'

describe('timezone tests', () => {
  it('should store dates as UTC', async () => {
    const tz = await db.getval<Date>('SELECT modified FROM test LIMIT 1')
    expect(tz).to.be.a('Date')
    expect(new Date().getTime() - tz!.getTime()).to.be.lessThan(5000)
  })
})

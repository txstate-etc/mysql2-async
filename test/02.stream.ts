/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src'

describe('streaming tests', () => {
  it('should be able to stream a row at a time', async () => {
    const stream = db.stream('SELECT * FROM test')
    let atleastone = false
    for await (const row of stream) {
      atleastone = true
      expect(row?.name).to.match(/^name \d+/)
    }
    expect(atleastone).to.be.true
  })

  it('should be able to stream a row at a time with a high watermark setting', async () => {
    const stream = db.stream({ highWaterMark: 10 }, 'SELECT * FROM test')
    let atleastone = false
    for await (const row of stream) {
      atleastone = true
      expect(row?.name).to.match(/^name \d+/)
    }
    expect(atleastone).to.be.true
  })
})

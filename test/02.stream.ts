/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src/db'
import Db from '../src/index'

describe('streaming tests', () => {
  it('should be able to stream a row at a time', async () => {
    const stream = db.stream<{ name: string }>('SELECT * FROM test')
    let count = 0
    for await (const row of stream) {
      count++
      expect(row?.name).to.match(/^name \d+/)
    }
    expect(count).to.equal(1000)
  })

  it('should be able to stream with the iterator syntax', async () => {
    const iterator = db.iterator<{ name: string }>('SELECT * FROM test')
    let count = 0
    while (true) {
      const { value: row, done } = await iterator.next()
      if (done) break
      count++
      expect(row.name).to.match(/^name \d+/)
    }
    expect(count).to.equal(1000)
  })

  it('should be able to stream a row at a time with a high watermark setting', async () => {
    const stream = db.stream('SELECT * FROM test', { highWaterMark: 10 })
    let count = 0
    for await (const row of stream) {
      count++
      expect(row?.name).to.match(/^name \d+/)
    }
    expect(count).to.equal(1000)
  })

  it('should properly release connections back to the pool', async () => {
    for (let i = 0; i < 15; i++) {
      const stream = db.stream('SELECT * FROM test LIMIT 100')
      for await (const row of stream) {
        expect(row?.name).to.match(/name \d+/)
      }
    }
    // if transactions eat connections then it will hang indefinitely after 10 transactions
    // getting this far means things are working
    expect(true).to.be.true
  })

  it('should properly release connections back to the pool when an async iterator loop throws an error', async () => {
    let errorthrown = false
    for (let i = 0; i < 15; i++) {
      const stream = db.stream('SELECT * FROM test LIMIT 100')
      try {
        for await (const row of stream) {
          expect(row?.name).to.match(/name \d+/)
          throw new Error('Fail!')
        }
      } catch (e) {
        expect(e.message).to.equal('Fail!')
        errorthrown = true
      }
    }
    // if transactions eat connections then it will hang indefinitely after 10 transactions
    // getting this far means things are working
    expect(errorthrown).to.be.true
  })

  it('should properly release connections back to the pool when a query has a syntax error', async () => {
    let errorthrown = false
    for (let i = 0; i < 15; i++) {
      const stream = db.stream('SELECT * FROM test3 LIMIT 100')
      try {
        for await (const row of stream) {
          expect(row?.name).to.match(/name \d+/)
        }
      } catch (e) {
        errorthrown = true
      }
    }
    // if transactions eat connections then it will hang indefinitely after 10 transactions
    // getting this far means things are working
    expect(errorthrown).to.be.true
  })

  it('should properly release connections back to the pool when the consumer cancels the stream', async () => {
    let errorthrown = false
    for (let i = 0; i < 15; i++) {
      const stream = db.stream('SELECT * FROM test LIMIT 100')
      try {
        for await (const row of stream) {
          expect(row?.name).to.match(/name \d+/)
          stream.destroy()
        }
      } catch (e) {
        errorthrown = true
      }
    }
    // if transactions eat connections then it will hang indefinitely after 10 transactions
    // getting this far means things are working
    expect(errorthrown).to.be.false
  })

  it('should properly release connections back to the pool when the consumer stops processing the stream', async () => {
    let errorthrown = false
    for (let i = 0; i < 15; i++) {
      const stream = db.stream('SELECT * FROM test LIMIT 100')
      try {
        for await (const row of stream) {
          expect(row?.name).to.match(/name \d+/)
          break
        }
      } catch (e) {
        errorthrown = true
      }
    }
    // if transactions eat connections then it will hang indefinitely after 10 transactions
    // getting this far means things are working
    expect(errorthrown).to.be.false
  })

  it('should properly release connections back to the pool when the consumer cancels the stream before the database is connected', async () => {
    const db2 = new Db()
    for (let i = 0; i < 15; i++) {
      const stream = db2.stream('SELECT * FROM test LIMIT 100')
      stream.destroy()
    }
    const stream = db2.stream('SELECT * FROM test LIMIT 100')
    for await (const row of stream) {
      expect(row?.name).to.match(/name \d+/)
    }
    // if transactions eat connections then it will hang indefinitely after 10 transactions
    // getting this far means things are working
  })

  it('should connect to the database when a stream is the first thing attempted', async () => {
    const db2 = new Db()
    const stream = db2.stream<{ name: string }>('SELECT * FROM test LIMIT 100')
    let count = 0
    for await (const row of stream) {
      count++
      expect(row?.name).to.match(/^name \d+/)
    }
    expect(count).to.equal(100)
  })

  it('should show the library consumer in the error stacktrace when a streaming query errors', async () => {
    try {
      const stream = db.stream('SELECT blah FROM test')
      for await (const row of stream) {
        expect(row).to.exist
      }
      expect(true).to.be.false('should have thrown for SQL error')
    } catch (e) {
      expect(e.stack).to.match(/02\.stream\.ts/)
    }
  })
})

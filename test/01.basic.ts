/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src/db'

describe('basic tests', () => {
  it('should be able to create a couple test tables', async () => {
    await Promise.all([
      db.execute(`CREATE TABLE test (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name TINYTEXT,
        modified DATETIME
      ) ENGINE = INNODB`),
      db.execute(`CREATE TABLE test2 (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name TINYTEXT,
        modified DATETIME
      ) ENGINE = INNODB`)
    ])
    const dbs = await db.getall('SHOW TABLES')
    expect(dbs?.length).to.be.greaterThan(0)
  })

  it('should be able to add test data', async () => {
    const promises = []
    for (let i = 0; i < 1000; i++) {
      promises.push(db.insert('INSERT INTO test (name, modified) VALUES (?, NOW())', [`name ${i}`]))
    }
    const ids = await Promise.all(promises)
    expect(ids?.length).to.equal(1000)
    expect(ids[0]).to.be.a('number')
  })

  it('should be able to add more test data', async () => {
    const promises = []
    for (let i = 0; i < 1000; i++) {
      promises.push(db.insert('INSERT INTO test2 (name, modified) VALUES (?, NOW())', [`name ${i}`]))
    }
    const ids = await Promise.all(promises)
    expect(ids?.length).to.equal(1000)
    expect(ids[0]).to.be.a('number')
  })

  it('should be able to select all rows', async () => {
    const rows = await db.getall('SELECT * FROM test')
    expect(rows?.length).to.equal(1000)
    expect(rows[0].name).to.be.a('string')
  })

  it('should be able to select a single row', async () => {
    const row = await db.getrow<{ name: string }>('SELECT * FROM test WHERE name=?', ['name 3'])
    expect(row?.name).to.equal('name 3')
  })

  it('should be able to select a single column in a single row', async () => {
    const name = await db.getval<string>('SELECT name FROM test WHERE name=?', ['name 3'])
    expect(name).to.equal('name 3')
  })

  it('should be able to select a single column in multiple rows', async () => {
    const names = await db.getvals<string>('SELECT name FROM test ORDER BY name LIMIT 5')
    expect(names[3]).to.equal('name 100')
    expect(names).to.have.lengthOf(5)
  })

  it('should be able to update a row', async () => {
    const rows = await db.update('UPDATE test SET name=? WHERE name=?', ['name 1002', 'name 999'])
    expect(rows).to.equal(1)
    const [newrow, oldrow] = await Promise.all([
      db.getrow('SELECT * FROM test WHERE name=?', ['name 1002']),
      db.getrow('SELECT * FROM test WHERE name=?', ['name 999'])
    ])
    expect(newrow).to.exist
    expect(oldrow).to.be.undefined
  })
  it('should help you construct IN queries', async () => {
    const params: any[] = []
    const rows = await db.getall(`SELECT * FROM test WHERE name IN (${db.in(params, ['name 2', 'name 5'])}) OR name IN (${db.in(params, ['name 8', 'name 9'])})`, params)
    expect(rows).to.have.lengthOf(4)
  })
  it('should help you construct IN queries with named parameters', async () => {
    const params: { [keys: string]: string } = {}
    const rows = await db.getall(`SELECT * FROM test WHERE name IN (${db.in(params, ['name 2', 'name 5'])}) OR name IN (${db.in(params, ['name 8', 'name 9'])})`, params)
    expect(rows).to.have.lengthOf(4)
  })
  it('should show the library consumer in the error stacktrace when a query errors', async () => {
    try {
      await db.getval('SELECT blah FROM test')
      expect(true).to.be.false('should have thrown for SQL error')
    } catch (e) {
      expect(e.stack).to.match(/01\.basic\.ts/)
    }
  })
})

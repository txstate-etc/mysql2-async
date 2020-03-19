/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src'

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

  it('should be able to select all rows', async () => {
    const rows = await db.getall('SELECT * FROM test')
    expect(rows?.length).to.equal(1000)
    expect(rows[0].name).to.be.a('string')
  })

  it('should be able to select a single row', async () => {
    const row = await db.getrow('SELECT * FROM test WHERE name=?', ['name 3'])
    expect(row?.name).to.equal('name 3')
  })

  it('should be able to select a single column in a single row', async () => {
    const name = await db.getval('SELECT name FROM test WHERE name=?', ['name 3'])
    expect(name).to.equal('name 3')
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
})

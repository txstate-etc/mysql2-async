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
})

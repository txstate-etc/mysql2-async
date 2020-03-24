/* eslint-disable @typescript-eslint/no-unused-expressions */
/* global describe, it */
import { expect } from 'chai'
import db from '../src/db'

describe('named placeholder tests', () => {
  it('should support named placeholders', async () => {
    const rows = await db.getall('SELECT * FROM test WHERE id=:id', { id: 15 })
    expect(rows?.length).to.equal(1)
    expect(rows?.[0]?.id).to.equal(15)
  })
})

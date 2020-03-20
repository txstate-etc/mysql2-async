# mysql2-async
A wrapper for mysql2 to add convenience, especially when developing with async/await and async iterables.

# Overview
This library has a few core principles:
* Focus on promises and async iterators, do away with callbacks and event-emitting streams
* Make advanced usage optional but easy, e.g.:
  * transactions
  * streaming large result sets
  * prepared statements
* Make it difficult to make a mistake, e.g.:
  * Always use a connection pool
  * Hide everything having to do with acquiring/releasing connections
  * Fix timezones (by default) so that we are always storing UTC in the database

# Getting Started
## Standard connection
Works just like creating a mysql2 pool. You will want to make a single pool and export it so that it can be imported all over your code.
```javascript
import Db from 'mysql2-async'
export const db = new Db({
  host: 'yourhost',
  ...
})

async function main() {
  const row = await db.getrow('SELECT ...')
}
main().catch(e => console.error(e))
```
## Connect with environment variables
When working in docker, it's common to keep database configuration in environment variables. In order to
make that easy, this library provides a convenient way to import a singleton pool created with the following
environment variables:
```
  MYSQL_HOST (default 'localhost')
  MYSQL_DATABASE (default 'default_database')
  MYSQL_USER (default 'root')
  MYSQL_PASS
  MYSQL_POOL_SIZE (default is mysql2's default)
  MYSQL_SKIPTZFIX (default false)
```
This way, connecting is very simple, and you don't have to worry about creating a singleton pool for the
rest of your codebase to import:
```javascript
import db from 'mysql2-async/db'

async function main() {
  const row = await db.getrow('SELECT ...')
}
main().catch(e => console.error(e))
```

# Usage
A lot of convenience methods are provided that allow you to specify the kind of operation you are about
to do and the kind of return data you expect.
## Querying
```javascript
const rows = await db.getall('SELECT name FROM mytable')
console.log(rows) // [{ name: 'John' }, { name: 'Maria' }, ...]
const row = await db.getrow('SELECT name FROM mytable WHERE name=?', ['John'])
console.log(row) // { name: 'John' }
const name = await db.getval('SELECT name FROM mytable WHERE name=?', ['John'])
console.log(name) // John
```
## Mutating
```javascript
const insertId = await db.insert('INSERT INTO mytable (name) VALUES (?)', ['Mike'])
const rowsUpdated = await db.update('UPDATE mytable SET name=? WHERE name=?', ['Johnny', 'John'])
const success = await db.execute('CREATE TABLE anothertable ...')
```
## Streaming
### Async Iterator
The async iterator approach is by far the simplest. It works almost exactly like `.getall()`, except
the advantage here is that the entire result set will never be loaded into memory, which will prevent
issues when dealing with thousands or millions of rows.
```javascript
const stream = db.stream('SELECT name FROM mytable')
for await (const row of stream) {
  // work on the row
}
```
Note that `.stream()` returns a node `Readable` in object mode, so you can easily do other things with
it like `.pipe()` it to another stream processor.
### Iterator .next()
Another available approach is to use the iterator pattern directly. This is a standard javascript iterator
that you would receive from anything that supports the async iterator pattern. Probably to be avoided unless
you are working with multiple result sets at the same time (e.g. syncing two tables).
```javascript
const iterator = db.iterator('SELECT name FROM mytable')
while (true) {
  const { value: row, done } = await iterator.next()
  if (!done) {
    // work on the row
  } else {
    break
  }
}
```
## Transactions
A method is provided to support working inside a transaction. Since the core Db object is a mysql pool, you
cannot send transaction commands without this method, as each command would end up on a different connection.

To start a transaction, provide a callback that MUST return a promise (just make it async). A new instance of
`db` is provided to the callback, it represents a single connection, inside a transaction. You do NOT send
`START TRANSACTION`, `ROLLBACK`, or `COMMIT` as these are handled automatically.
```javascript
await db.transaction(async db => { // both queries below happen in the same transaction
  const row = await db.getrow('SELECT * FROM ...')
  await db.update('UPDATE mytable SET ...')
})
```
If you need to roll back, simply throw an error. Similarly, any query that throws an error will trigger a rollback.
```javascript
await db.transaction(async db => { // both queries below happen in the same transaction
  const id = await db.insert('INSERT INTO user ...')
  throw new Error('oops!')
}) // the INSERT will be rolled back and will not happen
```

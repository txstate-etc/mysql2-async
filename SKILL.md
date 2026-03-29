# mysql2-async

Wraps `mysql2`. Use `mysql2-async` for ALL MySQL database access in this project. Do not use `mysql2` directly.

## Setup

Preferred: use the pre-configured instance with environment variables (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASS`, `MYSQL_POOL_SIZE`, `MYSQL_SKIPTZFIX`):
```typescript
import db from 'mysql2-async/db'
```

Alternative: create a custom pool (do this once and export it):
```typescript
import Db from 'mysql2-async'
export const db = new Db({ host: 'yourhost', database: 'yourdb', /* ...PoolOptions */ })
```

CommonJS requires `.default`:
```javascript
const db = require('mysql2-async/db').default
```

## Querying

Use the convenience methods — do not use `.query()` unless you need the raw mysql2 result.

```typescript
// multiple rows
const rows = await db.getall<MyType>('SELECT * FROM mytable WHERE active=?', [true])

// single row (returns undefined if not found)
const row = await db.getrow<MyType>('SELECT * FROM mytable WHERE id=?', [id])

// single value
const count = await db.getval<number>('SELECT COUNT(*) FROM mytable')

// column of values
const names = await db.getvals<string>('SELECT name FROM mytable')
```

## Mutating

```typescript
const insertId = await db.insert('INSERT INTO mytable (name) VALUES (?)', ['Mike'])
const rowsAffected = await db.update('UPDATE mytable SET name=? WHERE id=?', ['Johnny', 1])
const rowsAffected = await db.delete('DELETE FROM mytable WHERE id=?', [1])
await db.execute('CREATE TABLE ...')
```

`update` returns affected rows (matched WHERE), not changed rows. Make them match if necessary:
```typescript
const rowsChanged = await db.update('UPDATE mytable SET name=:name WHERE id=:id AND name!=:name', { name: 'Johnny', id: 1 })
```

## Bind Parameters

Positional (`?`) with arrays, or named (`:name`) with objects:
```typescript
await db.getall('SELECT * FROM t WHERE id=? AND name=?', [1, 'John'])
await db.getall('SELECT * FROM t WHERE id=:id AND name=:name', { id: 1, name: 'John' })
```

## IN Helper

Use `db.in()` for `IN` clauses — it mutates your binds and returns the SQL fragment:
```typescript
const binds = [authorId]
const rows = await db.getall(`
  SELECT * FROM books
  WHERE author = ? AND genre IN (${db.in(binds, genres)})
`, binds)
```

Tupled `IN` clauses — pass arrays as elements:
```typescript
const binds: any[] = []
const names = [{ first: 'John', last: 'Doe' }, { first: 'Maria', last: 'Smith' }]
const rows = await db.getall(`
  SELECT * FROM mytable
  WHERE (first_name, last_name) IN (${db.in(binds, names.map(n => [n.first, n.last]))})
`, binds)
```

Multi-row inserts — pass arrays as elements and omit the outer parentheses:
```typescript
const binds: any[] = []
await db.insert(`INSERT INTO mytable (name, age) VALUES ${db.in(binds, [['John', 30], ['Maria', 25]])}`, binds)
```

## Transactions

Pass an async callback. The `db` parameter is scoped to the transaction — never allow use of global `db` during transaction. The return value of the callback is passed through.
```typescript
const lineitemId = await db.transaction(async db => {
  const row = await db.getrow('SELECT * FROM accounts WHERE id=? FOR UPDATE', [id])
  await db.update('UPDATE accounts SET balance=? WHERE id=?', [row.balance - amount, id])
  return await db.insert('INSERT INTO lineitems (account_id, amount) VALUES (?, ?)', [id, -amount])
})
```

Less preferred, may use full table locks (must list all tables involved):
```typescript
await db.transaction(async db => {
  // ...
}, { lockForWrite: ['accounts', 'lineitems'], lockForRead: [] })
```

Commit and rollback are automatic. If any error occurs, throw for automatic rollback.

Retry deadlocks with `{ retries: N }`:
```typescript
await db.transaction(async db => { /* ... */ }, { retries: 2 })
```

Enable functions to work in or out of transactions:
```typescript
async function getAccount(id: number, txDb: Queryable = db, forUpdate = false) {
  return await txDb.getrow(`SELECT * FROM accounts WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [id])
}
```

Run in transaction if not in one already:
```typescript
async function fixAccountName(id: number, txDb: Queryable = db) {
  const action = async (db: Queryable) => {
    const account = await db.getrow('SELECT * FROM accounts WHERE id=? FOR UPDATE', [id])
    const fixedName = account.name.trim().toLowerCase()
    await db.update('UPDATE accounts SET name=? WHERE id=?', [fixedName, id])
  }
  if (txDb instanceof Db) return await txDb.transaction(action)
  else return await action(txDb)
}
```
## Streaming (Large Result Sets)

Use `for await` to avoid loading everything into memory:
```typescript
const stream = db.stream<MyType>('SELECT * FROM bigtable')
for await (const row of stream) {
  // process row
}
```

`break` or throwing inside the loop cleans up automatically.

For advanced use, `db.iterator()` gives a manual async iterator (remember to call `await iterator.return()` if you abandon it early).

## Prepared Statements

Add `{ saveAsPrepared: true }` option for frequently-run complex queries. Use of `db.in` with an array of inconsistent length probably invalidates performance benefit.
```typescript
await db.getall('SELECT ... complicated ...', [binds], { saveAsPrepared: true })
```

## Timezone Handling

By default, all dates are stored and retrieved as UTC. This applies to `DEFAULT CURRENT_TIMESTAMP`, `NOW()`, and JS `Date` objects. Dates coming out of the database will be JS `Date` objects in the application server time zone. Disable with `skiptzfix: true` or `MYSQL_SKIPTZFIX=true` only if working with a legacy database that doesn't store UTC.

## Graceful Shutdown

```typescript
await db.end()
```

For servers, close the server first so in-flight requests can finish, then end the pool.

## Waiting for MySQL

Use `await db.wait()` to block until MySQL is reachable (retries on ENOTFOUND/ECONNREFUSED). Protects you when mysql and application are starting concurrently (container environments).

## Query Logging
```typescript
db.logQueries(async (sql, elapsedMs, rowsUpdated) => {
  console.log(`${sql} took ${elapsedMs}ms`)
})
```

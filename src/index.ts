import mysql, { Pool, PoolConnection, RowDataPacket, OkPacket, Query } from 'mysql2'
import { sleep } from 'txstate-utils'
import { Readable } from 'stream'

export interface DbConfig {
  host: string
  user: string
  password: string
  database: string
  skiptzfix?: boolean
  connectionLimit?:
  number
}

export interface QueryOptions {
  saveAsPrepared?: boolean
}

export interface StreamOptions extends QueryOptions {
  highWaterMark?: number
  objectMode?: boolean
}

type BindParam = any

// implemented my own conversion to Readable stream because mysql2's is broken:
// it calls stream.emit('close') while the consumer is still reading from the buffer
// higher highWaterMark settings make it worse
function stream (query: Query, options: StreamOptions) {
  const anyquery = query as any
  options = options || {}
  options.objectMode = true
  let canceled = false
  const stream = new Readable(options)
  stream._read = () => {
    anyquery._connection && anyquery._connection.resume()
  }
  stream._destroy = (err, cb) => {
    if (err) stream.emit('error', err)
    canceled = true
    stream.push(null)
    anyquery._connection.resume()
    cb()
  }
  query.on('result', row => {
    if (canceled) return
    if (!stream.push(row)) {
      anyquery._connection.pause()
    }
  })
  query.on('error', err => {
    if (canceled) return
    stream.emit('error', err)
  })
  query.on('end', () => {
    if (canceled) return
    stream.push(null)
  })
  return stream
}

export class Queryable {
  protected conn: PoolConnection | Pool

  constructor (conn: PoolConnection | Pool) {
    this.conn = conn
  }

  async query (sql: string, binds?: BindParam[], options?: QueryOptions): Promise<RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[]> {
    return new Promise((resolve, reject) => {
      if (options?.saveAsPrepared) {
        this.conn.execute(sql, binds, (err, result) => {
          if (err) reject(err)
          else resolve(result)
        })
      } else {
        this.conn.query(sql, binds, (err, result) => {
          if (err) reject(err)
          else resolve(result)
        })
      }
    })
  }

  async getval (sql: string, binds?: BindParam[], options?: QueryOptions) {
    const row = await this.getrow(sql, binds, options)
    if (row) return Object.values(row)[0]
    return undefined
  }

  async getrow (sql: string, binds?: BindParam[], options?: QueryOptions) {
    const results = await this.getall(sql, binds, options)
    if (results?.length > 0) return results?.[0]
    return undefined
  }

  async getall (sql: string, binds?: BindParam[], options?: QueryOptions) {
    const results = await this.query(sql, binds, options)
    return results as RowDataPacket[]
  }

  async execute (sql: string, binds?: BindParam[], options?: QueryOptions) {
    await this.query(sql, binds, options)
    return true
  }

  async update (sql: string, binds?: BindParam[], options?: QueryOptions) {
    const result = await this.query(sql, binds, options)
    return (result as OkPacket).changedRows
  }

  async insert (sql: string, binds?: BindParam[], options?: QueryOptions) {
    const result = await this.query(sql, binds, options)
    return (result as OkPacket).insertId
  }

  stream (sql: string, options: StreamOptions): Readable
  stream (sql: string, binds?: BindParam[], options?: StreamOptions): Readable
  stream (sql: string, bindsOrOptions: any, options?: StreamOptions) {
    let binds
    if (!options && (bindsOrOptions?.highWaterMark || bindsOrOptions?.objectMode)) {
      options = bindsOrOptions
      binds = []
    } else {
      binds = bindsOrOptions
    }
    const result = options?.saveAsPrepared ? this.conn.execute(sql, binds) : this.conn.query(sql, binds)
    return stream(result, options ?? {})
  }

  iterator (sql: string, options: StreamOptions): AsyncIterableIterator<RowDataPacket>
  iterator (sql: string, binds?: BindParam[], options?: StreamOptions): AsyncIterableIterator<RowDataPacket>
  iterator (sql: string, bindsOrOptions: any, options?: StreamOptions) {
    const ret = this.stream(sql, bindsOrOptions, options)[Symbol.asyncIterator]()
    return ret
  }
}

export class Db extends Queryable {
  protected pool: Pool

  constructor (config?: DbConfig) {
    const resolvedConfig: DbConfig = {
      host: config?.host ?? process.env.MYSQL_HOST ?? process.env.DB_HOST ?? 'mysql',
      user: config?.user ?? process.env.MYSQL_USER ?? process.env.DB_USER ?? 'root',
      password: config?.password ?? process.env.MYSQL_PASS ?? process.env.DB_PASS ?? 'secret',
      database: config?.database ?? process.env.MYSQL_DATABASE ?? process.env.DB_DATABASE ?? 'default_database',
      skiptzfix: (config?.skiptzfix ?? false) || Boolean(process.env.MYSQL_SKIPTZFIX),
      connectionLimit: config?.connectionLimit ?? parseInt(process.env.MYSQL_POOL_SIZE ?? process.env.DB_POOL_SIZE ?? '10')
    }
    const pool = mysql.createPool({
      host: resolvedConfig.host,
      user: resolvedConfig.user,
      password: resolvedConfig.password,
      database: resolvedConfig.database,
      connectionLimit: resolvedConfig.connectionLimit,
      // client side connectTimeout is unstable in mysql2 library
      // it throws an error you can't catch and crashes node
      // best to leave this at 0 (disabled)
      connectTimeout: 0,
      ...(resolvedConfig.skiptzfix ? { timezone: 'Z' } : {})
    })
    if (!resolvedConfig.skiptzfix) {
      pool.on('connection', function (connection) {
        connection.query('SET time_zone="UTC"')
      })
    }
    super(pool)
    this.pool = pool
  }

  async wait () {
    while (true) {
      try {
        await this.getrow('select 1')
        break
      } catch (err) {
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
          await sleep(500)
        } else {
          throw err
        }
      }
    }
  }

  async transaction (callback: (db: Queryable) => Promise<void>) {
    const conn = await new Promise<PoolConnection>((resolve, reject) => {
      this.pool.getConnection((err: any, conn: PoolConnection) => {
        if (err) reject(err)
        else resolve(conn)
      })
    })
    const db = new Queryable(conn)
    try {
      await db.execute('START TRANSACTION')
      try {
        await callback(db)
        await db.execute('COMMIT')
      } catch (e) {
        await db.execute('ROLLBACK')
        throw e
      }
    } finally {
      conn.release()
    }
  }
}

export default new Db()

import mysql, { Pool, PoolConnection, RowDataPacket, OkPacket } from 'mysql2'
import { sleep } from 'txstate-utils'
import { Readable } from 'stream'

export interface DbConfig {
  host: string
  user: string
  password: string
  database: string
  skiptzfix?: boolean
  connectionLimit?: number
}

type BindParam = string|number

export class Queryable {
  protected conn: PoolConnection | Pool

  constructor (conn: PoolConnection | Pool) {
    this.conn = conn
  }

  protected async query (sql: string, binds: BindParam[]): Promise<RowDataPacket[] | OkPacket> {
    return new Promise((resolve, reject) => {
      this.conn.query(sql, binds, (err, result) => {
        if (err) reject(err)
        else resolve(result as RowDataPacket[] | OkPacket)
      })
    })
  }

  async getval (sql: string, ...binds: BindParam[]) {
    const row = await this.getrow(sql, ...binds)
    if (row) return Object.values(row)[0]
    return undefined
  }

  async getrow (sql: string, ...binds: BindParam[]) {
    const results = await this.getall(sql, ...binds)
    if (results?.length > 0) return results?.[0]
    return undefined
  }

  async getall (sql: string, ...binds: BindParam[]) {
    const results = await this.query(sql, binds)
    return results as RowDataPacket[]
  }

  async execute (sql: string, ...binds: BindParam[]) {
    await this.query(sql, binds)
    return true
  }

  async update (sql: string, ...binds: BindParam[]) {
    const result = await this.query(sql, binds)
    return (result as OkPacket).changedRows
  }

  async insert (sql: string, ...binds: BindParam[]) {
    const result = await this.query(sql, binds)
    return (result as OkPacket).insertId
  }

  stream (sql: string, ...binds: BindParam[]): Readable
  stream (options: { highWaterMark?: number, objectMode?: boolean }, sql: string, ...binds: BindParam[]): Readable
  stream (optionsOrSql: any, sqlOrFirstBind: any, ...binds: BindParam[]) {
    let sql, options
    if (typeof optionsOrSql === 'string') {
      sql = optionsOrSql
      binds.unshift(sqlOrFirstBind)
    } else {
      sql = sqlOrFirstBind
      options = optionsOrSql
    }
    const opts = {
      highWaterMark: options?.highWaterMark ?? 100,
      objectMode: options?.objectMode ?? true
    }
    const result = this.conn.query(sql, binds)
    return result.stream(opts)
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

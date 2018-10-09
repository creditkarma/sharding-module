import * as mysql from 'mysql'

interface Queryable { query: mysql.QueryFunction }
export function query(client: Queryable, sql: string, values?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        client.query(sql, values, (err, result) => {
            if (err) {
                reject(err)
            } else {
                resolve(result)
            }
        })
    })
}

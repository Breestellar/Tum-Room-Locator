import os
import mysql.connector
from mysql.connector import pooling

# Create a connection pool at startup — reuses connections instead of opening a new one on every request

connection_pool = pooling.MySQLConnectionPool(
    pool_name="tum_locator_pool",
    pool_size=10,   
    pool_reset_session=True,
    host=os.getenv("DB_HOST"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    database=os.getenv("DB_NAME"),
    port=int(os.getenv("DB_PORT", 3306))
)

def get_db():
    return connection_pool.get_connection()
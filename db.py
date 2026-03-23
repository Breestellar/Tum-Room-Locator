import mysql.connector

def get_db():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="@Ellrani2345",
        database="tum_room_locator"
    )
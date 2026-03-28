import os
from db import get_db
from flask import Flask, render_template, request, redirect, url_for, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = 'supersecretkey' 

# ------------------ Password hashing ------------------ # 
def hash_password(password):
    return generate_password_hash(password)

# ------------------- Home ------------------ #
@app.route('/')
def home():
    return render_template('home.html')

# ------------------- Register ------------------ #
@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        conn = get_db()
        cursor = conn.cursor()

        username = request.form['username']
        password = generate_password_hash(request.form['password'])
        role = request.form['role']

        try:
            cursor.execute("INSERT INTO users (username, password, role) VALUES (%s, %s, %s)", 
                           (username, password, role))
            conn.commit()
        except Exception as e:
            print(e)
            conn.rollback()
        finally:
            cursor.close()
            conn.close()

        return redirect(url_for('login'))

    return render_template('register.html')

# ------------------- Context Processor ------------------ #
@app.context_processor
def inject_user():
    return dict(
        current_user={
            "is_authenticated": 'user_id' in session,
            "role": session.get('role')
        }
    )


# ------------------- Login ------------------ #
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        username = request.form['username']
        password = request.form['password']

        cursor.execute("SELECT * FROM users WHERE username=%s", (username,))
        user = cursor.fetchone()

        if user and check_password_hash(user['password'], password):
            return redirect(url_for('map_view'))
        return "Invalid username or password"

    return render_template('login.html')


# ------------------- Admin Dashboard ------------------ #
@app.route('/admin')
def admin():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM campus")
    campuses = cursor.fetchall()

    cursor.execute("SELECT * FROM building")
    buildings = cursor.fetchall()

    cursor.execute("SELECT * FROM room")
    rooms = cursor.fetchall()

    return render_template('admin_dashboard.html', campuses=campuses, buildings=buildings, rooms=rooms)

# --------------------  Add Campus ------------------ #
@app.route('/admin/add_campus', methods=['POST'])
def add_campus():
    conn = get_db()
    cursor = conn.cursor()

    name = request.form['name']
    cursor.execute("INSERT INTO campus (name) VALUES (%s)", (name,))
    conn.commit()

    return redirect('/admin')

# ---------------- ADD BUILDING ---------------- #
@app.route('/admin/add_building', methods=['POST'])
def add_building():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO building (campus_id, name, latitude, longitude)
        VALUES (%s, %s, %s, %s)
    """, (
        request.form['campus_id'],
        request.form['name'],
        request.form['latitude'],
        request.form['longitude']
    ))

    conn.commit()
    return redirect('/admin')


# ---------------- ADD ROOM ---------------- #
@app.route('/admin/add_room', methods=['POST'])
def add_room():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO room (building_id, name, description, floor)
        VALUES (%s, %s, %s, %s)
    """, (
        request.form['building_id'],
        request.form['name'],
        request.form.get('description', ''),
        request.form.get('floor', '')
    ))

    conn.commit()
    return redirect('/admin')


# ---------------- MAP PAGE ---------------- #
@app.route('/map')
def map_view():
    return render_template('map.html')

# ---------------- SEARCH API ---------------- #
@app.route('/api/search')
def search():
    query = request.args.get('q')

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT room.id, room.name, room.floor,
               building.name AS building_name,
               building.latitude, building.longitude
        FROM room
        JOIN building ON room.building_id = building.id
        WHERE room.name LIKE %s
    """, (f"%{query}%",))

    results = cursor.fetchall()

    return jsonify(results)

# ---------------- API: BUILDINGS ---------------- #
@app.route('/api/buildings')
def api_buildings():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM building")
    buildings = cursor.fetchall()

    return jsonify(buildings)


# ---------------- API: ROOMS ---------------- #
@app.route('/api/rooms/<int:building_id>')
def api_rooms(building_id):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM room WHERE building_id=%s", (building_id,))
    rooms = cursor.fetchall()

    return jsonify(rooms)

# -------------------  Logout ------------------ #
@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

# ---------------- RUN ---------------- #
if __name__ == '__main__':
    app.run(debug=True)
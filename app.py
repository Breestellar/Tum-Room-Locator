import re
from db import get_db
from flask import Flask, render_template, request, redirect, url_for, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = 'supersecretkey'


#------------------------ HELPER FUNCTIONS ------------------------#

def require_admin():
    return session.get('role') == 'admin'


def normalize_query(q):
    q = q.lower()
    q = q.replace("rm", "room ")
    q = re.sub(r'[^a-z0-9 ]', '', q)
    q = re.sub(r'\s+', ' ', q).strip()
    return q


#------------------------ CONTEXT PROCESSORS ------------------------#

@app.context_processor
def inject_user():
    return dict(
        current_user={
            "is_authenticated": 'user_id' in session,
            "role": session.get('role')
        }
    )


#--------------------- HOME PAGE ---------------------#

@app.route('/')
def home():
    return render_template('home.html')


#------------------------- REGISTRATION ------------------------#

@app.route('/register', methods=['GET', 'POST'])
def register():

    if request.method == 'POST':

        username = request.form['username']
        password = request.form['password']
        confirm = request.form['confirm_password']

        if password != confirm:
            return render_template('register.html', error="Passwords do not match")

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        # Check duplicate user
        cursor.execute("SELECT id FROM users WHERE username=%s", (username,))
        existing = cursor.fetchone()

        if existing:
            cursor.close()
            conn.close()
            return render_template('register.html', error="Username already exists")

        hashed = generate_password_hash(password)

        cursor.execute(
            "INSERT INTO users (username, password, role) VALUES (%s, %s, 'user')",
            (username, hashed)
        )

        conn.commit()
        cursor.close()
        conn.close()

        return redirect('/login')

    return render_template('register.html')


#------------------------- LOGIN ------------------------#

@app.route('/login', methods=['GET', 'POST'])
def login():

    if request.method == 'POST':

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        username = request.form['username']
        password = request.form['password']

        cursor.execute("SELECT * FROM users WHERE username=%s", (username,))
        user = cursor.fetchone()

        cursor.close()
        conn.close()

        if user and check_password_hash(user['password'], password):

            session['user_id'] = user['id']
            session['role'] = user['role']

            return redirect('/admin' if user['role'] == 'admin' else '/map')

        return render_template('login.html', error="Invalid credentials")

    return render_template('login.html')


#------------------------- LOGOUT ------------------------#

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))


#-------------------------- ADMIN DASHBOARD --------------------------#

@app.route('/admin')
def admin():

    if not require_admin():
        return "Unauthorized", 403

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM campus")
    campuses = cursor.fetchall()

    cursor.execute("SELECT * FROM building")
    buildings = cursor.fetchall()

    cursor.execute("SELECT * FROM room")
    rooms = cursor.fetchall()

    cursor.close()
    conn.close()

    return render_template(
        'admin_dashboard.html',
        campuses=campuses,
        buildings=buildings,
        rooms=rooms
    )


#----------------------- ADD CAMPUS -----------------------#

@app.route('/admin/add_campus', methods=['POST'])
def add_campus():

    if not require_admin():
        return "Unauthorized", 403

    name = request.form['name']

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("INSERT INTO campus (name) VALUES (%s)", (name,))

    conn.commit()
    cursor.close()
    conn.close()

    return redirect('/admin')


#----------------------- ADD BUILDING -----------------------#

@app.route('/admin/add_building', methods=['POST'])
def add_building():

    if not require_admin():
        return "Unauthorized", 403

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
    cursor.close()
    conn.close()

    return redirect('/admin')


#----------------------- ADD ROOM -----------------------#

@app.route('/admin/add_room', methods=['POST'])
def add_room():

    if not require_admin():
        return "Unauthorized", 403

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
    cursor.close()
    conn.close()

    return redirect('/admin')


#-------------------------- DELETE BUILDING --------------------------#

@app.route('/admin/delete_building/<int:id>')
def delete_building(id):

    if not require_admin():
        return "Unauthorized", 403

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM building WHERE id=%s", (id,))

    conn.commit()
    cursor.close()
    conn.close()

    return redirect('/admin')


#-------------------------- DELETE ROOM --------------------------#

@app.route('/admin/delete_room/<int:id>')
def delete_room(id):

    if not require_admin():
        return "Unauthorized", 403

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM room WHERE id=%s", (id,))

    conn.commit()
    cursor.close()
    conn.close()

    return redirect('/admin')


#-------------------------- MAP VIEW --------------------------#

@app.route('/map')
def map_view():
    building_id = request.args.get('building_id')
    return render_template('map.html', building_id=building_id)


#-------------------------- SEARCH API --------------------------#

@app.route('/api/search')
def search():

    query = normalize_query(request.args.get('q', ''))

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    sql = """
        SELECT b.id, b.name,
               b.latitude AS lat,
               b.longitude AS lng,
               c.name AS campus_name
        FROM building b
        JOIN campus c ON b.campus_id = c.id
        WHERE LOWER(b.name) LIKE %s
        LIMIT 10
    """

    cursor.execute(sql, (f"%{query}%",))
    results = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(results)


#-------------------------- BUILDINGS API --------------------------#

@app.route('/api/buildings')
def api_buildings():

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM building")
    buildings = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify([
        {
            'id': b['id'],
            'name': b['name'],
            'lat': float(b['latitude']),
            'lng': float(b['longitude'])
        } for b in buildings
    ])


#-------------------------- ROOMS API --------------------------#
@app.route('/api/rooms/<int:building_id>')
def api_rooms(building_id):

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM room WHERE building_id=%s", (building_id,))
    rooms = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(rooms)


#------------------- RUN APP -------------------#

if __name__ == '__main__':
    app.run(debug=True)
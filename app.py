import email
import re

from click import confirm
from db import get_db
from flask import Flask, flash, render_template, request, redirect, url_for, jsonify, session
from flask_mail import Mail, Message
from itsdangerous import URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import db

app = Flask(__name__)
app.secret_key = 'supersecretkey'

#------------------------- MAIL CONFIG ------------------------#
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = 'your_email@gmail.com'
app.config['MAIL_PASSWORD'] = 'your_app_password'

mail = Mail(app)

serializer = URLSafeTimedSerializer(app.secret_key)


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
        email = request.form['email']
        username = request.form['username']
        password = request.form['password']
        confirm = request.form['confirm_password']

        if password != confirm:
            return render_template('register.html', error="Passwords do not match")

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        # check duplicates
        cursor.execute("SELECT id FROM users WHERE username=%s OR email=%s", (username, email))
        existing = cursor.fetchone()

        if existing:
            cursor.close()
            conn.close()
            return render_template('register.html', error="Username or Email already exists")

        hashed = generate_password_hash(password)

        cursor.execute(
            "INSERT INTO users (username, email, password, role) VALUES (%s, %s, %s, 'user')",
            (username, email, hashed)
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

#------------------------- FORGOT PASSWORD ------------------------#
@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        email = request.form['email']

        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id FROM users WHERE username=%s", (email,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if user:
            token = serializer.dumps(email, salt='password-reset')

            reset_link = url_for('reset_password', token=token, _external=True)

            msg = Message('Password Reset Request',
                          sender=app.config['MAIL_USERNAME'],
                          recipients=[email])
            msg.body = f'Click this link to reset your password: {reset_link}'

            mail.send(msg)

        flash('If that email exists, a reset link has been sent.', 'info')
        return redirect(url_for('login'))

    return render_template('forgot_password.html')


#------------------------- PASSWORD RESET ------------------------#
@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    try:
        email = serializer.loads(token, salt='password-reset', max_age=3600)
    except:
        flash('The reset link is invalid or expired.', 'danger')
        return redirect(url_for('forgot_password'))

    if request.method == 'POST':
        new_password = request.form['password']

        conn = get_db()
        cursor = conn.cursor()
        hashed = generate_password_hash(new_password)
        cursor.execute("UPDATE users SET password=%s WHERE username=%s", (hashed, email))
        conn.commit()
        cursor.close()
        conn.close()

        flash('Password updated successfully.', 'success')
        return redirect(url_for('login'))

    return render_template('reset_password.html')

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

    try:
        lat = float(request.form['latitude'])
        lng = float(request.form['longitude'])
    except ValueError:
        return "Invalid coordinates", 400

    #range validation
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return "Coordinates out of range", 400

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO building (campus_id, name, latitude, longitude)
        VALUES (%s, %s, %s, %s)
    """, (
        request.form['campus_id'],
        request.form['name'],
        lat,
        lng
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

@app.route('/admin/delete_building', methods=['POST'])
def delete_building():

    if not require_admin():
        return "Unauthorized", 403

    building_id = request.form['id']

    conn = get_db()
    cursor = conn.cursor()

    try:
        cursor.execute("DELETE FROM building WHERE id=%s", (building_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        return f"Error deleting building: {str(e)}", 500
    finally:
        cursor.close()
        conn.close()

    return redirect('/admin')


#-------------------------- DELETE ROOM --------------------------#

@app.route('/admin/delete_room', methods=['POST'])
def delete_room():

    if not require_admin():
        return "Unauthorized", 403

    room_id = request.form['id']

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM room WHERE id=%s", (room_id,))

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

    query = request.args.get('q', '').lower().strip()

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    sql = """
        SELECT b.id AS building_id,
               b.name AS building_name,
               b.latitude AS lat,
               b.longitude AS lng,
               r.name AS room_name,
               r.floor,
               r.instructions
        FROM building b
        LEFT JOIN room r ON r.building_id = b.id
        WHERE
            LOWER(b.name) LIKE %s
            OR (r.name IS NOT NULL AND LOWER (r.name) LIKE %s)
        LIMIT 10
    """

    cursor.execute(sql, (f"%{query}%", f"%{query}%"))
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
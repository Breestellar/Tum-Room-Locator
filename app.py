import re, random
from datetime import datetime, timedelta
from functools import wraps
from db import get_db
from flask import Flask, flash, render_template, request, redirect, url_for, jsonify, session
from flask_mail import Mail, Message
from itsdangerous import URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = 'supersecretkey'

#------------------------- MAIL CONFIG ------------------------#
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = 'tumroomlocator@gmail.com'
app.config['MAIL_PASSWORD'] = 'wvmj sszc amiz zkrd'
app.config['MAIL_DEFAULT_SENDER'] = app.config['MAIL_USERNAME']

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
    user_id = session.get("user_id")
    if not user_id:
        return dict(current_user=None)

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT username, email, role FROM users WHERE id=%s", (session['user_id'],))
    user = cursor.fetchone()

    cursor.close()
    conn.close()

    return dict(
        current_user={
            "is_authenticated": True,
            "username": user['username'],
            "email": user['email'],
            "role": user['role']
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

#------------------------- LOGIN REQUIRED DECORATOR ------------------------#

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please login first')
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


#------------------------- ADMIN REQUIRED DECORATOR ------------------------#

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))

        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id=%s", (session["user_id"],))
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if not user or user['role'] != "admin":
            flash("Unauthorized access", "danger")
            return redirect(url_for("map"))

        return f(*args, **kwargs)
    return decorated_function


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
            session['username'] = user['username']
            session['role'] = user['role']
            session.permanent = True

            return redirect('/admin' if user['role'] == 'admin' else '/map')

        return render_template('login.html', error="Invalid credentials")

    return render_template('login.html')


#------------------------- ACCOUNT PAGE ------------------------#

@app.route('/account')
@login_required
def account():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    return render_template('account.html')

#------------------------- CHANGE EMAIL ------------------------#

@app.route('/change-email', methods=['GET', 'POST'])
@login_required
def change_email():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    if request.method == 'POST':
        new_email = request.form['email']

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT id FROM users WHERE email=%s", (new_email,))
        existing = cursor.fetchone()

        if existing:
            flash('Email already in use', 'danger')
            cursor.close()
            conn.close()
            return redirect(url_for('change_email'))

        try:
            cursor.execute(
                "UPDATE users SET email=%s WHERE id=%s",
                (new_email, session['user_id'])
            )
            conn.commit()

        except Exception as e:
            conn.rollback()
            flash('Error updating email', 'danger')
            print(e)

        cursor.close()
        conn.close()

        flash('Email updated successfully', 'success')
        return redirect(url_for('account'))

    return render_template('change_email.html')


#------------------------- FORGOT PASSWORD ------------------------#
@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        email = request.form['email']

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()

        if user:
            otp = str(random.randint(100000, 999999))
            expiry = datetime.now() + timedelta(minutes=5)

            cursor.execute(
                "UPDATE users SET otp=%s, otp_expiry=%s WHERE email=%s",
                (otp, expiry, email)
            )
            conn.commit()

            msg = Message(
                'Your OTP Code',
                recipients=[email]
            )

            msg.body = f"""
Hello {user['username']},

Your OTP is: {otp}

It expires in 5 minutes.
"""

            mail.send(msg)

            cursor.close()
            conn.close()

            return redirect(url_for('reset_password', email=email))

        cursor.close()
        conn.close()
        flash('Email not found', 'danger')

    return render_template('forgot_password.html')


#------------------------- PASSWORD RESET ------------------------#
@app.route('/reset-password', methods=['GET', 'POST'])
def reset_password():

    email = request.args.get('email')

    if not email:
        return redirect(url_for('forgot_password'))

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    if request.method == 'POST':
        otp = request.form['otp']
        password = request.form['password']
        confirm = request.form['confirm_password']

        if password != confirm:
            flash('Passwords do not match', 'danger')
            return redirect(url_for('reset_password', email=email))

        cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()

        if not user:
            flash('User not found', 'danger')
            return redirect(url_for('forgot_password'))

        # check OTP
        if user['otp'] != otp:
            flash('Invalid OTP', 'danger')
            return redirect(url_for('reset_password', email=email))

        # check expiry
        if datetime.now() > user['otp_expiry']:
            flash('OTP expired. Request a new one.', 'danger')
            return redirect(url_for('forgot_password'))

        # update password
        hashed = generate_password_hash(password)

        cursor.execute(
            "UPDATE users SET password=%s, otp=NULL, otp_expiry=NULL WHERE email=%s",
            (hashed, email)
        )
        conn.commit()

        cursor.close()
        conn.close()

        flash('Password reset successful', 'success')
        return redirect(url_for('login'))

    cursor.close()
    conn.close()
    return render_template('reset_password.html', email=email)

#------------------------- CHANGE PASSWORD ------------------------#

@app.route('/change-password', methods=['GET', 'POST'])
@login_required
def change_password():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    if request.method == 'POST':
        current = request.form['current_password']
        new = request.form['new_password']
        confirm = request.form['confirm_password']

        if new != confirm:
            flash('Passwords do not match', 'danger')
            return redirect(url_for('change_password'))

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT password FROM users WHERE id=%s", (session['user_id'],))
        user = cursor.fetchone()

        if not check_password_hash(user['password'], current):
            flash('Current password incorrect', 'danger')
            cursor.close()
            conn.close()
            return redirect(url_for('change_password'))

        hashed = generate_password_hash(new)

        cursor.execute(
            "UPDATE users SET password=%s WHERE id=%s",
            (hashed, session['user_id'])
        )
        conn.commit()

        cursor.close()
        conn.close()

        flash('Password updated successfully', 'success')
        return redirect(url_for('account'))

    return render_template('change_password.html')

#------------------------- LOGOUT ------------------------#

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


#-------------------------- ADMIN DASHBOARD --------------------------#

@app.route('/admin')
@admin_required
def admin():

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
@admin_required
def add_campus():

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
@admin_required
def add_building():
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
@admin_required
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
    cursor.close()
    conn.close()

    return redirect('/admin')


#-------------------------- DELETE BUILDING --------------------------#

@app.route('/admin/delete_building', methods=['POST'])
@admin_required
def delete_building():

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
@admin_required
def delete_room():

    room_id = request.form['id']

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM room WHERE id=%s", (room_id,))

    conn.commit()
    cursor.close()
    conn.close()

    return redirect('/admin')


#-------------------------- MANAGE USERS --------------------------#

@app.route('/manage_users')
@admin_required
def manage_users():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, username, email, role, created_at
        FROM users
        ORDER BY created_at DESC
    """)
    users = cursor.fetchall()

    cursor.execute("SELECT COUNT(*) AS total FROM users")
    total_users = cursor.fetchone()['total']

    cursor.execute("""
        SELECT username, email, role, created_at
        FROM users
        ORDER BY created_at DESC
        LIMIT 5
    """)
    recent_users = cursor.fetchall()

    cursor.execute("""
        SELECT location_name, COUNT(*) AS count
        FROM searches
        WHERE location_name IS NOT NULL AND location_name != ''
        GROUP BY location_name
        ORDER BY count DESC
        LIMIT 5
    """)
    popular = cursor.fetchall()

    cursor.close()
    conn.close()

    return render_template(
        'manage_users.html',
        users=users,
        total_users=total_users,
        recent_users=recent_users,
        popular=popular
    )

#-------------------------- DELETE USER --------------------------#

@app.route("/admin/delete_user", methods=["POST"])
@login_required
@admin_required
def delete_user():
    user_id = request.form.get("user_id")

    if user_id:
        if str(user_id) == str(session.get("user_id")):
            flash("You cannot delete yourself", "danger")
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE id=%s", (user_id,))
            conn.commit()
            cursor.close()
            conn.close()

    return redirect(url_for("manage_users"))


#-------------------------- TOGGLE ROLE --------------------------#

@app.route("/admin/toggle_role", methods=["POST"])
@login_required
@admin_required
def toggle_role():
    user_id = request.form.get("user_id")
    if user_id:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT role FROM users WHERE id=%s", (user_id,))
        user = cursor.fetchone()

        if user:
            new_role = "admin" if user["role"] == "user" else "user"
            cursor.execute("UPDATE users SET role=%s WHERE id=%s", (new_role, user_id))
            conn.commit()

        cursor.close()
        conn.close()

    return redirect(url_for("manage_users"))


#-------------------------- MAP VIEW --------------------------#

@app.route('/map')
@login_required
def map_view():
    building_id = request.args.get('building_id')
    return render_template('map.html', building_id=building_id)


#-------------------------- SEARCH API --------------------------#

@app.route('/api/search')
@login_required
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

#-------------------------- RECENTS PAGE --------------------------#
@app.route('/recents')
@login_required
def recents():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('recents.html')

#------------------- RUN APP -------------------#

if __name__ == '__main__':
    app.run(debug=True)
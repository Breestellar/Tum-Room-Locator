import re, os, random, pandas as pd
from datetime import datetime, timedelta
from functools import wraps
from io import BytesIO
from db import get_db
from flask import Flask, flash, render_template, request, redirect, url_for, jsonify, session, send_file
from flask_mail import Mail, Message
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from werkzeug.security import check_password_hash, generate_password_hash
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev_fallback_key")
#------------------------- MAIL CONFIG ------------------------#

app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = app.config['MAIL_USERNAME']

mail = Mail(app)

#------------------------ EXCEL REPORT GENERATION ------------------------#

def generate_excel_report(title, data):
    buffer = BytesIO()
    df = pd.DataFrame(data)

    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Report', startrow=1)
        worksheet = writer.sheets['Report']
        worksheet.cell(row=1, column=1, value=title)

    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"{title.replace(' ', '_')}.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


#------------------------ PDF REPORT GENERATION WITH STYLES ------------------------#

def generate_pdf_report(title, data):
    output = BytesIO()

    doc = SimpleDocTemplate(output, pagesize=A4)
    elements = []
    styles = getSampleStyleSheet()

    elements.append(Paragraph(title, styles['Title']))
    elements.append(Paragraph(
        f"Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        styles['Normal']
    ))
    elements.append(Spacer(1, 12))

    if not data:
        elements.append(Paragraph("No records found.", styles['Normal']))
    else:
        headers = list(data[0].keys())
        table_data = [headers]

        for row in data:
            table_data.append([str(row.get(h, "")) for h in headers])

        table = Table(table_data, repeatRows=1)

        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.green),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ]))

        elements.append(table)

    doc.build(elements)

    output.seek(0)

    filename = f"{title.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"

    return send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype="application/pdf"
    )


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

#------------------------- REGISTRATION ------------------------#

@app.route('/register', methods=['GET', 'POST'])
def register():

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT 
            p.id,
            p.code,
            p.name,
            d.name AS department_name
        FROM programme p
        JOIN department d ON p.department_id = d.id
        ORDER BY p.code
    """)
    programmes = cursor.fetchall()

    if request.method == 'POST':
        email = request.form['email'].lower().strip()
        username = request.form['username']
        password = request.form['password']
        confirm = request.form['confirm_password']
        programme_id = request.form.get('programme_id') or None

        if email.endswith("@students.tum.ac.ke"):
            role = "student"

            if not programme_id:
                cursor.close()
                conn.close()
                return render_template(
                    'register.html',
                    programmes=programmes,
                    error="Please select your programme."
                )

        elif email.endswith("@tum.ac.ke"):
            role = "lecturer"
            programme_id = None
        else:
            cursor.close()
            conn.close()
            return render_template(
                "register.html",
                programmes=programmes,
                error="Only TUM students and lecturers can create accounts. Visitors can continue using the map without logging in."
            )

        if password != confirm:
            cursor.close()
            conn.close()
            return render_template(
                'register.html',
                programmes=programmes,
                error="Passwords do not match"
            )

        cursor.execute(
            "SELECT id FROM users WHERE username=%s OR email=%s",
            (username, email)
        )
        existing = cursor.fetchone()

        if existing:
            cursor.close()
            conn.close()
            return render_template(
                'register.html',
                programmes=programmes,
                error="Username or Email already exists"
            )

        hashed = generate_password_hash(password)

        cursor.execute("""
            INSERT INTO users (username, email, password, role, programme_id)
            VALUES (%s, %s, %s, %s, %s)
        """, (username, email, hashed, role, programme_id))

        conn.commit()
        cursor.close()
        conn.close()

        return redirect('/login')

    cursor.close()
    conn.close()

    return render_template('register.html', programmes=programmes)

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
            return redirect(url_for("map_view"))

        return f(*args, **kwargs)
    return decorated_function


#------------------------- LOGIN ------------------------#

@app.route('/login', methods=['GET', 'POST'])
def login():

    if request.method == 'POST':
        email = request.form['email'].lower().strip()
        password = request.form['password']

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()

        cursor.close()
        conn.close()

        if not user:
            return render_template('login.html', error="Invalid credentials")

        if user['role'] != 'admin':
            if not (
                user['email'].endswith("@students.tum.ac.ke") or
                user['email'].endswith("@tum.ac.ke")
            ):
                return render_template(
                    "login.html",
                    error="Only TUM organization emails can log in."
                )

        if check_password_hash(user['password'], password):
            session.clear()
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['email'] = user['email']
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

    location_type = request.form.get('location_type', 'building')
    has_rooms = 1 if request.form.get('has_rooms') else 0

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO building (campus_id, name, latitude, longitude, location_type, has_rooms)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        request.form['campus_id'],
        request.form['name'],
        lat,
        lng,
        location_type,
        has_rooms
    ))

    conn.commit()
    cursor.close()
    conn.close()

    return redirect('/admin')


#-------------------------- EDIT BUILDING --------------------------#

@app.route('/admin/edit_building/<int:building_id>', methods=['GET', 'POST'])
@admin_required
def edit_building(building_id):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    if request.method == 'POST':
        name = request.form['name']
        latitude = request.form['latitude']
        longitude = request.form['longitude']

        cursor.execute("""
            UPDATE building
            SET name=%s, latitude=%s, longitude=%s
            WHERE id=%s
        """, (name, latitude, longitude, building_id))

        conn.commit()
        cursor.close()
        conn.close()

        flash('Building updated successfully', 'success')
        return redirect(url_for('admin'))

    cursor.execute("SELECT * FROM building WHERE id=%s", (building_id,))
    building = cursor.fetchone()

    cursor.close()
    conn.close()

    return render_template('edit_building.html', building=building)


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


#-------------------------- EDIT ROOM --------------------------#

@app.route('/admin/edit_room/<int:room_id>', methods=['GET', 'POST'])
@admin_required
def edit_room(room_id):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    if request.method == 'POST':
        name = request.form['name']
        description = request.form.get('description', '')
        floor = request.form.get('floor', '')
        instructions = request.form.get('instructions', '')

        cursor.execute("""
            UPDATE room
            SET name=%s, description=%s, floor=%s, instructions=%s
            WHERE id=%s
        """, (name, description, floor, instructions, room_id))

        conn.commit()
        cursor.close()
        conn.close()

        flash('Room updated successfully', 'success')
        return redirect(url_for('admin'))

    cursor.execute("SELECT * FROM room WHERE id=%s", (room_id,))
    room = cursor.fetchone()

    cursor.close()
    conn.close()

    return render_template('edit_room.html', room=room)


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
            new_role = "admin" if user["role"] != "admin" else "student"
            cursor.execute("UPDATE users SET role=%s WHERE id=%s", (new_role, user_id))
            conn.commit()

        cursor.close()
        conn.close()

    return redirect(url_for("manage_users"))


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
        SELECT 
            b.id AS building_id,
            b.name AS building_name,
            b.latitude AS lat,
            b.longitude AS lng,
            b.location_type,
            b.has_rooms,
            r.id AS room_id,
            r.name AS room_name,
            r.floor,
            r.instructions
        FROM building b
        LEFT JOIN room r ON r.building_id = b.id
        WHERE
            LOWER(b.name) LIKE %s
            OR (r.name IS NOT NULL AND LOWER(r.name) LIKE %s)
        LIMIT 10
    """

    cursor.execute(sql, (f"%{query}%", f"%{query}%"))
    results = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(results)


#-------------------------- LOG SEARCH API --------------------------#

@app.route('/api/log-search', methods=['POST'])
def log_search():
    data = request.get_json()

    location_name = data.get('location_name', '').strip()
    building_id = data.get('building_id')
    room_id = data.get('room_id')
    user_id = session.get('user_id')
    visitor_token = session.get('visitor_token')

    if not visitor_token:
        visitor_token = os.urandom(16).hex()
        session['visitor_token'] = visitor_token

    if not location_name:
        return jsonify({"status": "ignored"})

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO searches (user_id, visitor_token, building_id, room_id, location_name)
        VALUES (%s, %s, %s, %s, %s)
    """, (user_id, visitor_token, building_id, room_id, location_name))

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"status": "success"})

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
            'lng': float(b['longitude']),
            'location_type': b.get('location_type', 'building'),
            'has_rooms': bool(b.get('has_rooms', True))
        } for b in buildings
    ])

#-------------------------- BUILDING SEARCH API --------------------------#

@app.route('/api/building-search')
def building_search():
    query = request.args.get('q', '').lower().strip()

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, name, latitude AS lat, longitude AS lng, location_type, has_rooms
        FROM building
        WHERE LOWER(name) LIKE %s
        ORDER BY name
        LIMIT 10
    """, (f"%{query}%",))

    buildings = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify([
        {
            "id": b["id"],
            "name": b["name"],
            "lat": float(b["lat"]),
            "lng": float(b["lng"]),
            "location_type": b.get("location_type", "building"),
            "has_rooms": bool(b.get("has_rooms", True))
        }
        for b in buildings
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
    return render_template('recents.html')


#-------------------------- RECENTS API --------------------------#

@app.route('/api/recents')
@login_required
def api_recents():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT *
        FROM recent_locations
        WHERE user_id=%s
        ORDER BY created_at DESC
        LIMIT 10
    """, (session['user_id'],))

    recents = cursor.fetchall()
    cursor.close()
    conn.close()

    return jsonify(recents)


#-------------------------- SAVE RECENT LOCATION API --------------------------#

@app.route('/api/recents', methods=['POST'])
@login_required
def save_recent_location():
    data = request.get_json()

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        DELETE FROM recent_locations
        WHERE user_id=%s AND location_name=%s
    """, (session['user_id'], data.get('location_name')))

    cursor.execute("""
        INSERT INTO recent_locations
        (user_id, building_id, room_id, location_name)
        VALUES (%s, %s, %s, %s)
    """, (
        session['user_id'],
        data.get('building_id'),
        data.get('room_id'),
        data.get('location_name')
    ))

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"status": "success"})


#-------------------------- TIMETABLE PAGE --------------------------#

@app.route('/timetable')
@login_required
def timetable():
    role = session.get('role')
    email = session.get('email')

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    if role == 'student':
        cursor.execute("SELECT programme_id FROM users WHERE id=%s", (session['user_id'],))
        user = cursor.fetchone()

        if not user or not user['programme_id']:
            flash("Your programme is not assigned yet.", "warning")
            cursor.close()
            conn.close()
            return render_template('timetable.html', classes=[])

        cursor.execute("""
            SELECT
                t.id,
                t.unit_name,
                t.day_of_week,
                t.start_time,
                t.end_time,
                t.lecturer_name,
                r.id AS room_id,
                r.name AS room_name,
                r.floor,
                r.instructions,
                b.name AS building_name,
                b.latitude,
                b.longitude
            FROM timetable t
            JOIN timetable_programme tp ON tp.timetable_id = t.id
            LEFT JOIN room r ON t.room_id = r.id
            LEFT JOIN building b ON r.building_id = b.id
            WHERE tp.programme_id=%s
            ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
                     t.start_time
        """, (user['programme_id'],))

    elif role == 'lecturer':
        cursor.execute("""
            SELECT
                t.id,
                t.unit_name,
                t.day_of_week,
                t.start_time,
                t.end_time,
                t.lecturer_name,
                r.id AS room_id,
                r.name AS room_name,
                r.floor,
                r.instructions,
                b.name AS building_name,
                b.latitude,
                b.longitude
            FROM timetable t
            JOIN timetable_lecturer tl ON tl.timetable_id = t.id
            LEFT JOIN room r ON t.room_id = r.id
            LEFT JOIN building b ON r.building_id = b.id
            WHERE tl.lecturer_email=%s
            ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
                     t.start_time
        """, (email,))

    else:
        cursor.close()
        conn.close()
        flash("Timetable is only available for students and lecturers.", "warning")
        return redirect(url_for('map_view'))

    classes = cursor.fetchall()
    cursor.close()
    conn.close()

    return render_template('timetable.html', classes=classes)


#-------------------------- ADMIN TIMETABLE --------------------------#

@app.route('/admin/timetable')
@admin_required
def admin_timetable():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            t.id,
            t.user_role,
            t.user_email,
            t.unit_name,
            t.day_of_week,
            t.start_time,
            t.end_time,
            t.lecturer_name,
            r.name AS room_name,
            b.name AS building_name
        FROM timetable t
        LEFT JOIN room r ON t.room_id = r.id
        LEFT JOIN building b ON r.building_id = b.id
        ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
                 t.start_time
    """)
    timetable_rows = cursor.fetchall()

    cursor.execute("""
        SELECT
            r.id,
            r.name AS room_name,
            r.floor,
            b.name AS building_name
        FROM room r
        LEFT JOIN building b ON r.building_id = b.id
        ORDER BY b.name, r.name
    """)
    rooms = cursor.fetchall()

    cursor.execute("""
        SELECT
            p.id,
            p.code,
            p.name,
            d.name AS department_name,
            s.name AS school_name
        FROM programme p
        JOIN department d ON p.department_id = d.id
        JOIN school s ON d.school_id = s.id
        ORDER BY s.name, d.name, p.code
    """)
    programmes = cursor.fetchall()

    cursor.close()
    conn.close()

    return render_template(
        'admin_timetable.html',
        timetable_rows=timetable_rows,
        rooms=rooms, programmes=programmes
    )

#-------------------------- ADD TIMETABLE RECORD --------------------------#

@app.route('/admin/add_timetable', methods=['POST'])
@admin_required
def add_timetable():
    user_role = request.form['user_role']
    user_email = request.form.get('user_email', '').strip().lower() or None
    unit_name = request.form['unit_name']
    room_id = request.form.get('room_id') or None
    day_of_week = request.form['day_of_week']
    start_time = request.form['start_time']
    end_time = request.form['end_time']
    lecturer_name = request.form.get('lecturer_name', '')

    if user_role not in ['student', 'lecturer']:
        flash("Invalid user role selected.", "danger")
        return redirect(url_for('admin_timetable'))

    conn = get_db()
    cursor = conn.cursor()
    if user_email:

        if user_role == 'student' and not user_email.endswith('@students.tum.ac.ke'):
            flash("Student email must end with @students.tum.ac.ke", "danger")
            return redirect(url_for('admin_timetable'))

        if user_role == 'lecturer' and not user_email.endswith('@tum.ac.ke'):
            flash("Lecturer email must end with @tum.ac.ke", "danger")
            return redirect(url_for('admin_timetable'))

    cursor.execute("""
        INSERT INTO timetable
        (user_role, user_email, unit_name, room_id, day_of_week, start_time, end_time, lecturer_name)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        user_role,
        user_email,
        unit_name,
        room_id,
        day_of_week,
        start_time,
        end_time,
        lecturer_name
    ))

    timetable_id = cursor.lastrowid

    programme_ids = request.form.getlist('programme_ids')
    for programme_id in programme_ids:
        cursor.execute("""
            INSERT INTO timetable_programme (timetable_id, programme_id)
            VALUES (%s, %s)
        """, (timetable_id, programme_id))

    lecturer_emails = request.form.get('lecturer_emails', '')
    for lec_email in lecturer_emails.split(','):
        lec_email = lec_email.strip().lower()
        if lec_email:
            cursor.execute("""
                INSERT INTO timetable_lecturer (timetable_id, lecturer_email)
                VALUES (%s, %s)
            """, (timetable_id, lec_email))

    conn.commit()
    cursor.close()
    conn.close()

    flash("Timetable record added successfully.", "success")
    return redirect(url_for('admin_timetable'))

#-------------------------- DELETE TIMETABLE RECORD --------------------------#

@app.route('/admin/delete_timetable', methods=['POST'])
@admin_required
def delete_timetable():
    timetable_id = request.form['id']

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM timetable WHERE id=%s", (timetable_id,))

    conn.commit()
    cursor.close()
    conn.close()

    flash("Timetable record deleted.", "success")
    return redirect(url_for('admin_timetable'))

#-------------------------- REPORTS PAGE --------------------------#

@app.route('/reports')
@admin_required
def reports():
    return render_template('reports.html')

#-------------------------- EXPORT REPORT API --------------------------#
@app.route('/export-report')
@admin_required
def export_report():
    report_type = request.args.get('report_type', 'users')
    file_format = request.args.get('format', 'excel')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    title = "System Report"

    if report_type == 'users':
        title = "Users Report"
        query = "SELECT id, username, email, role, created_at FROM users WHERE 1=1"
        params = []

        if start_date:
            query += " AND DATE(created_at) >= %s"
            params.append(start_date)

        if end_date:
            query += " AND DATE(created_at) <= %s"
            params.append(end_date)

        query += " ORDER BY created_at DESC"
        cursor.execute(query, params)
        data = cursor.fetchall()

    elif report_type == 'locations':
        title = "Locations Report"
        cursor.execute("""
            SELECT 
                b.id AS building_id,
                b.name AS building_name,
                b.latitude,
                b.longitude,
                r.name AS room_name,
                r.floor,
                r.description
            FROM building b
            LEFT JOIN room r ON r.building_id = b.id
            ORDER BY b.name, r.name
        """)
        data = cursor.fetchall()

    elif report_type == 'searches':
        title = "Search Analytics Report"
        query = """
            SELECT 
                s.location_name,
                COUNT(*) AS search_count,
                MAX(s.created_at) AS last_searched
            FROM searches s
            WHERE s.location_name IS NOT NULL AND s.location_name != ''
        """
        params = []

        if start_date:
            query += " AND DATE(s.created_at) >= %s"
            params.append(start_date)

        if end_date:
            query += " AND DATE(s.created_at) <= %s"
            params.append(end_date)

        query += """
            GROUP BY s.location_name
            ORDER BY search_count DESC
        """

        cursor.execute(query, params)
        data = cursor.fetchall()

    else:
        title = "System Summary Report"
        cursor.execute("SELECT COUNT(*) AS total_users FROM users")
        total_users = cursor.fetchone()['total_users']

        cursor.execute("SELECT COUNT(*) AS total_buildings FROM building")
        total_buildings = cursor.fetchone()['total_buildings']

        cursor.execute("SELECT COUNT(*) AS total_rooms FROM room")
        total_rooms = cursor.fetchone()['total_rooms']

        cursor.execute("SELECT COUNT(*) AS total_searches FROM searches")
        total_searches = cursor.fetchone()['total_searches']

        data = [{
            "total_users": total_users,
            "total_buildings": total_buildings,
            "total_rooms": total_rooms,
            "total_searches": total_searches,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }]

    cursor.close()
    conn.close()

    if file_format == 'pdf':
        return generate_pdf_report(title, data)

    return generate_excel_report(title, data)


def generate_excel_report(title, data):
    output = BytesIO()

    df = pd.DataFrame(data)

    if df.empty:
        df = pd.DataFrame([{"Message": "No records found"}])

    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="Report")

        workbook = writer.book
        worksheet = writer.sheets["Report"]

        worksheet.insert_rows(1)
        worksheet["A1"] = title
        worksheet["A2"] = f"Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

        for column_cells in worksheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter

            for cell in column_cells:
                if cell.value:
                    max_length = max(max_length, len(str(cell.value)))

            worksheet.column_dimensions[column_letter].width = max_length + 3

    output.seek(0)

    filename = f"{title.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

    return send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

#------------------- RUN APP -------------------#

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
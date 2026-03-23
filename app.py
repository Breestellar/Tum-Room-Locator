import os
from db import get_db
from flask import Flask, render_template, request, redirect, url_for, jsonify
from flask_login import LoginManager, login_user, login_required, logout_user, UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = 'supersecretkey'  # Replace this with a secure key in production

login_manager = LoginManager(app)
login_manager.login_view = 'login'

class User(UserMixin):
    def __init__(self, user_id, username, role):
        self.id = str(user_id)
        self.username = username
        self.role = role

@login_manager.user_loader
def load_user(user_id):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()
    if not user:
        return None
    return User(user['id'], user['username'], user['role'])

# ------------------ Password hashing ------------------ # 
def hash_password(password):
    return generate_password_hash(password)

# ------------------- Home ------------------ #
@app.route('/')
def home():
    return render_template('home.html')

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
            user_obj = User(user['id'], user['username'], user['role'])
            login_user(user_obj)
            return redirect(url_for('admin_dashboard' if user_obj.role == 'admin' else 'map_view'))

        return redirect(url_for('login'))

    return render_template('login.html')


# ------------------- Admin Dashboard ------------------ #
@app.route('/admin')
@login_required
def admin_dashboard():
    return render_template('admin_dashboard.html')

# --------------------  Add Campus ------------------ #
@app.route('/admin/add_campus', methods=['POST'])
@login_required
def add_campus():
    name = request.form['name']
    return redirect(url_for('admin_dashboard'))

# Admin: Add Building
@app.route('/admin/add_building', methods=['POST'])
@login_required
def add_building():
    return redirect(url_for('admin_dashboard'))

# Admin: Add Room
@app.route('/admin/add_room', methods=['POST'])
@login_required
def add_room():
    return redirect(url_for('admin_dashboard'))

# User Map Page
@app.route('/user/map')
@login_required
def map_view():
    return render_template('map.html')

# API Endpoints for Map Data
@app.route('/api/buildings')
def api_buildings():
    buildings = buildings.query.all()
    data = []
    for b in buildings:
        data.append({
            'name': b.name,
            'id': b.id
        })
    return jsonify(data)

@app.route('/api/rooms/<int:building_id>')
def api_rooms(building_id):
    rooms = rooms.query.filter_by(building_id=building_id).all()
    data = []
    for r in rooms:
        data.append({
            'name': r.name,
            'description': r.description,
            'floor': r.floor
        })
    return jsonify(data)



# -------------------  Get Buildings ------------------ #
@app.route('/api/buildings')
def get_buildings():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM building")
    buildings = cursor.fetchall()

    return jsonify(buildings)

# -------------------  Logout ------------------ #
@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('home'))

if __name__ == '__main__':
    app.run(debug=True)
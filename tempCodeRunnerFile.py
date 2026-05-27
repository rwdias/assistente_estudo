from database import listar_materias

materias = listar_materias(so_nome=True)

for materia in materias:
    print(materia)
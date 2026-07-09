"""cascade completo materia subdivisao pergunta opcao revisao

Revision ID: 609cafac04c8
Revises: 6e1803397d26
Create Date: 2026-07-08 18:35:49.335038

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '609cafac04c8'
down_revision: Union[str, Sequence[str], None] = '6e1803397d26'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# As FKs originais (criadas via Base.metadata.create_all antes deste projeto
# nomear constraints) não têm nome no SQLite. Uma `naming_convention` passada
# a `batch_alter_table` faz a reflexão gerar um nome determinístico para
# essas constraints anônimas, permitindo referenciá-las em drop_constraint.
_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
}


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table(
        'opcoes', schema=None, naming_convention=_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint('fk_opcoes_pergunta_id_perguntas', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_opcoes_pergunta_id_perguntas',
            'perguntas', ['pergunta_id'], ['id'], ondelete='CASCADE',
        )

    with op.batch_alter_table(
        'perguntas', schema=None, naming_convention=_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_perguntas_subdivisao_id_subdivisoes', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_perguntas_subdivisao_id_subdivisoes',
            'subdivisoes', ['subdivisao_id'], ['id'], ondelete='CASCADE',
        )

    with op.batch_alter_table(
        'revisoes_perguntas', schema=None, naming_convention=_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_revisoes_perguntas_pergunta_id_perguntas', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_revisoes_perguntas_pergunta_id_perguntas',
            'perguntas', ['pergunta_id'], ['id'], ondelete='CASCADE',
        )

    with op.batch_alter_table(
        'subdivisoes', schema=None, naming_convention=_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_subdivisoes_materia_id_materias', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_subdivisoes_materia_id_materias',
            'materias', ['materia_id'], ['id'], ondelete='CASCADE',
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('subdivisoes', schema=None) as batch_op:
        batch_op.drop_constraint('fk_subdivisoes_materia_id_materias', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_subdivisoes_materia_id_materias', 'materias', ['materia_id'], ['id']
        )

    with op.batch_alter_table('revisoes_perguntas', schema=None) as batch_op:
        batch_op.drop_constraint(
            'fk_revisoes_perguntas_pergunta_id_perguntas', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_revisoes_perguntas_pergunta_id_perguntas',
            'perguntas', ['pergunta_id'], ['id'],
        )

    with op.batch_alter_table('perguntas', schema=None) as batch_op:
        batch_op.drop_constraint(
            'fk_perguntas_subdivisao_id_subdivisoes', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_perguntas_subdivisao_id_subdivisoes',
            'subdivisoes', ['subdivisao_id'], ['id'],
        )

    with op.batch_alter_table('opcoes', schema=None) as batch_op:
        batch_op.drop_constraint('fk_opcoes_pergunta_id_perguntas', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_opcoes_pergunta_id_perguntas', 'perguntas', ['pergunta_id'], ['id']
        )
